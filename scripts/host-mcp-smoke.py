#!/usr/bin/env python3
"""Optional real Codex smoke for the installed typed local SEOsmith binding.

Uses a disposable CODEX_HOME and no account credentials. It:

  1. installs the local marketplace and plugin through the real Codex CLI
     CLI (actual package install),
  2. asks the Codex app-server to discover installed skills and the plugin's
     `seosmith_local` MCP server/tools (actual host discovery, no agent turn),
  3. speaks normal MCP stdio to the installed server with a schema-faithful
     synthetic adapter and a disposable private root, exercising
     capabilities/start/status/cancel/report/export and receipt verification
     (synthetic saved data).

When `--real-adapter PATH` (or SEOSMITH_REAL_ADAPTER) is supplied, it also
discovers the real adapter's capabilities through the same installed server.
That is offline and does not crawl. This script never contacts HTP or a live
site and never starts an agent session or changes approvals/sandbox/auth.
"""
import argparse
import hashlib
import json
import os
import select
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_REL = "server/seosmith-operations-mcp.mjs"
FIXTURE = ROOT / "scripts" / "fixtures" / "seosmith-adapter-fixture.mjs"
EXPECTED_SKILLS = {
    "htp:repository-settings",
    "htp:seo-review",
    "htp:website-management",
    "htp:seosmith-operations",
    "htp:lifecycle-remediation",
}
EXPECTED_TOOLS = {
    "seosmith_capabilities",
    "seosmith_start",
    "seosmith_status",
    "seosmith_cancel",
    "seosmith_report",
    "seosmith_export",
}
UUID_A = "b2a844c8-5bc9-49e5-bcf0-8fd1407d69f4"
UUID_B = "4822f25e-af3c-4c60-a8c6-31bd99d2acda"


def host_version_checked():
    """Refuse a Codex CLI below the declared minimum in host-minimum.json (not host-enforced)."""
    declared = json.loads((ROOT / "host-minimum.json").read_text())["codex-cli"]
    out = subprocess.run(["codex", "--version"], check=True, capture_output=True, text=True, timeout=30).stdout
    found = out.split()[-1]
    if tuple(int(x) for x in found.split(".")) < tuple(int(x) for x in declared.split(".")):
        raise SystemExit(f"codex-cli {found} is below the declared minimum {declared}")
    return found


class JsonRpc:
    """Newline-delimited JSON-RPC client over a subprocess's stdio."""

    def __init__(self, argv, env):
        self.proc = subprocess.Popen(
            argv,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )
        self._id = 0

    def _write(self, message):
        payload = (json.dumps(message) + "\n").encode()
        self.proc.stdin.write(payload)
        self.proc.stdin.flush()

    def request(self, method, params, timeout=60):
        self._id += 1
        ident = self._id
        self._write({"jsonrpc": "2.0", "id": ident, "method": method, "params": params})
        buffer = b""
        while True:
            ready, _, _ = select.select([self.proc.stdout.fileno()], [], [], timeout)
            if not ready:
                raise TimeoutError(f"timed out waiting for {method}")
            chunk = os.read(self.proc.stdout.fileno(), 1)
            if not chunk:
                raise RuntimeError(f"transport closed during {method}")
            if chunk != b"\n":
                buffer += chunk
                continue
            message = json.loads(buffer)
            buffer = b""
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(f"{method} error: {message['error']}")
                return message["result"]

    def notify(self, method, params):
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def install(env):
    def cli(*args):
        result = subprocess.run(
            ["codex", "plugin", *args], env=env, capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            raise RuntimeError(f"codex plugin {args} failed: {result.stderr.strip()}")
        return result.stdout

    cli("marketplace", "add", str(ROOT))
    installed = json.loads(cli("add", "htp@htp-codex", "--json"))
    return Path(installed["installedPath"])


def app_server_discovery(env):
    proc = JsonRpc(["codex", "app-server"], env)
    try:
        # Codex app-server requires initialize before requests; it is not an
        # agent turn and creates no thread.
        proc.request(
            "initialize",
            {"clientInfo": {"name": "htp-mcp-smoke", "version": "1"}},
        )
        proc.notify("initialized", {})
        skills = proc.request("skills/list", {"cwds": [str(ROOT)], "forceReload": True})
        for group in skills["data"]:
            if group.get("errors"):
                raise AssertionError(f"skill discovery reported errors: {group['errors']}")
        found_skills = {
            skill["name"]
            for group in skills["data"]
            for skill in group["skills"]
            if "htp:" in skill["name"]
        }
        if found_skills != EXPECTED_SKILLS:
            raise AssertionError(f"installed skills differ: {found_skills!r}")

        status = proc.request("mcpServerStatus/list", {"serverName": "seosmith_local"})
        servers = {server["name"]: server for server in status["data"]}
        if "seosmith_local" not in servers:
            raise AssertionError("seosmith_local was not registered")
        server = servers["seosmith_local"]
        if server.get("toolsError"):
            raise AssertionError(f"MCP tool discovery failed: {server['toolsError']}")
        tools = set(server.get("tools", {}).keys())
        if tools != EXPECTED_TOOLS:
            raise AssertionError(f"discovered tools differ: {tools!r}")
        server_info = server.get("serverInfo") or {}
        return tools, server_info
    finally:
        proc.close()


def make_fixture_bin(base):
    node = os.path.realpath(shutil.which("node") or "")
    if not node:
        raise RuntimeError("node was not found on PATH")
    bin_dir = base / "bin"
    bin_dir.mkdir(parents=True, mode=0o700)
    adapter = bin_dir / "adapter"
    source = FIXTURE.read_text()
    lines = source.splitlines(keepends=True)
    lines[0] = f"#!{node}\n"
    adapter.write_text("".join(lines))
    adapter.chmod(0o755)
    return adapter


def mcp_client(server_script, base, adapter, enable_export=True):
    root = base / "root"
    root.mkdir(parents=True, mode=0o700)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(base),
        "SEOSMITH_BIN": str(adapter),
        "SEOSMITH_ROOT": str(root),
    }
    client = JsonRpc([shutil.which("node"), str(server_script)], env)
    client.request(
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}},
    )
    client.notify("notifications/initialized", {})
    return client, root


def call(client, name, arguments=None):
    result = client.request("tools/call", {"name": name, "arguments": arguments or {}})
    return result


def unavailable_default(server_script, base):
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(base),
    }
    client = JsonRpc([shutil.which("node"), str(server_script)], env)
    try:
        client.request(
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}},
        )
        client.notify("notifications/initialized", {})
        caps = call(client, "seosmith_capabilities")["structuredContent"]
        assert caps["available"] is False, caps
        assert caps["reason"] == "adapter_not_configured", caps
        assert caps["htp"]["available"] is False, caps
        start = call(
            client,
            "seosmith_start",
            {
                "request_id": UUID_A,
                "website_id": UUID_B,
                "url": "https://example.com/",
                "max_pages": 20,
                "max_resources": 20,
                "max_duration_seconds": 60,
                "delay_ms": 1000,
                "check_external_links": False,
            },
        )
        assert start["isError"] is True, start
        assert start["structuredContent"]["error"] == "unavailable", start
    finally:
        client.close()


def lifecycle(server_script, base):
    adapter = make_fixture_bin(base)
    client, root = mcp_client(server_script, base, adapter)
    try:
        caps = call(client, "seosmith_capabilities")
        assert caps["isError"] is False, caps
        assert caps["structuredContent"]["available"] is True, caps
        assert caps["structuredContent"]["adapter_version"] == 1, caps
        assert caps["structuredContent"]["transport"] == "local_cli", caps
        assert caps["structuredContent"]["htp"]["available"] is False, caps
        assert caps["structuredContent"]["worker"]["available"] is False, caps

        start = call(
            client,
            "seosmith_start",
            {
                "request_id": UUID_A,
                "website_id": UUID_B,
                "url": "https://example.com/",
                "max_pages": 20,
                "max_resources": 20,
                "max_duration_seconds": 60,
                "delay_ms": 1000,
                "check_external_links": False,
            },
        )
        assert start["isError"] is False, start
        assert start["structuredContent"]["state"] == "partial", start

        status = call(client, "seosmith_status", {"request_id": UUID_A})
        assert status["structuredContent"]["state"] == "partial", status
        assert status["structuredContent"]["execution_state"] == "terminal", status

        cancel = call(client, "seosmith_cancel", {"request_id": UUID_A})
        assert cancel["structuredContent"]["cancellation_terminal"] is False, cancel

        report = call(client, "seosmith_report", {"request_id": UUID_A})["structuredContent"]
        report_bytes = report["report"].encode()
        assert report["bytes"] == len(report_bytes), report
        assert report["sha256"] == hashlib.sha256(report_bytes).hexdigest(), report

        export = call(client, "seosmith_export", {"request_id": UUID_A})["structuredContent"]
        assert export["verified"] is True, export
        on_disk = Path(export["output_path"]).read_bytes()
        assert on_disk == report_bytes, "export bytes differ from report bytes"
        assert export["sha256"] == report["sha256"], export

        conflict = call(
            client,
            "seosmith_start",
            {
                "request_id": UUID_A,
                "website_id": UUID_B,
                "url": "https://other.example/",
                "max_pages": 20,
                "max_resources": 20,
                "max_duration_seconds": 60,
                "delay_ms": 1000,
                "check_external_links": False,
            },
        )
        assert conflict["isError"] is True, conflict
        assert conflict["structuredContent"]["error"] == "request_id_conflict", conflict
        return export["sha256"]
    finally:
        client.close()


def real_adapter_capabilities(server_script, base, real_bin):
    root = base / "real-root"
    root.mkdir(parents=True, mode=0o700)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(base),
        "SEOSMITH_BIN": str(real_bin),
        "SEOSMITH_ROOT": str(root),
    }
    client = JsonRpc([shutil.which("node"), str(server_script)], env)
    try:
        client.request(
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}},
        )
        client.notify("notifications/initialized", {})
        caps = call(client, "seosmith_capabilities")["structuredContent"]
        assert caps["available"] is True, caps
        assert caps["adapter_version"] == 1, caps
        assert caps["transport"] == "local_cli", caps
        for operation in ("seosmith.start", "seosmith.status", "seosmith.cancel", "seosmith.report", "seosmith.export"):
            assert operation in caps["operations"], (operation, caps)
        return caps
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real-adapter", default=os.environ.get("SEOSMITH_REAL_ADAPTER"))
    args = parser.parse_args()
    if not shutil.which("codex"):
        raise SystemExit("codex CLI is not on PATH")
    host = host_version_checked()

    with tempfile.TemporaryDirectory(prefix="htp-codex-mcp-smoke-") as home:
        base = Path(home)
        env = {**os.environ, "CODEX_HOME": str(base / "codex-home")}
        (base / "codex-home").mkdir(mode=0o700)
        installed = install(env)
        server_script = installed / SERVER_REL
        if not server_script.is_file():
            raise AssertionError(f"installed server missing: {server_script}")
        tools, server_info = app_server_discovery(env)
        unavailable_default(server_script, base / "default")
        receipt = lifecycle(server_script, base / "fixture")
        line = (
            f"Codex {host} installed the plugin, discovered "
            f"{len(EXPECTED_SKILLS)} skills and {len(tools)} MCP tools "
            f"(serverInfo {server_info.get('name')} {server_info.get('version')}); "
            "synthetic lifecycle report/export matched with receipt "
            f"sha256 {receipt}."
        )
        if args.real_adapter:
            real = Path(args.real_adapter)
            if not real.is_file():
                raise SystemExit(f"real adapter not found: {real}")
            caps = real_adapter_capabilities(server_script, base / "real", real)
            line += (
                f" Real adapter {real} advertised adapter_version {caps['adapter_version']} "
                f"transport {caps['transport']} with {len(caps['operations'])} operations."
            )
        print(line)


if __name__ == "__main__":
    main()
