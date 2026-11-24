#!/usr/bin/env python3
"""Ordinary Codex CLI OAuth acceptance against a synthetic loopback fixture.

This smoke exercises the supported, ordinary Codex CLI path for a
Streamable-HTTP MCP server that requires OAuth:

  1. `codex mcp add <name> --url http://127.0.0.1:<port>/mcp` registers the
     server and completes the host-managed OAuth authorization-code + PKCE
     flow against a cooperative loopback fixture, and
  2. `codex mcp login <name>` reconnects after a logout,
  3. the Codex app-server discovers the authenticated MCP tool catalog, and
  4. `codex mcp logout <name>` removes the stored credential and an
     unauthenticated catalog request is refused.

Every connection is loopback (127.0.0.1). The script runs itself once inside
`unshare -rn` (user + network namespace with `lo` up) so no external traffic is
reachable, unless `--already-isolated` is passed in an existing sandbox. It uses
a fresh private HOME / CODEX_HOME / TMPDIR and never reads or writes the caller's
real Codex profile or credentials. All OAuth client ids, codes and tokens are
synthetic, process-lifetime, in-memory fixture values. No model inference, agent
turn, approval change or sandbox change is performed.

Usage:
  python3 scripts/host-oauth-smoke.py approve
  python3 scripts/host-oauth-smoke.py deny
  python3 scripts/host-oauth-smoke.py approve --summary /path/summary.json

The script exits 0 only when every assertion for the scenario passes.
"""
import argparse
import json
import os
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "scripts" / "fixtures" / "oauth-mcp-fixture.mjs"
SERVER_NAME = "oauth_fixture"
EXPECTED_TOOLS = {"hello_world_secured", "synthetic_saved_read"}
AUTHORIZE_RE = re.compile(r"http://127\.0\.0\.1:\d+/authorize\?[^\s]+")
SECRET_RE = re.compile(r"(code_challenge|state|code|client_id|code_verifier)=[^&\s]+")
TOKEN_RE = re.compile(r"\b(at|rt|code)-[A-Za-z0-9_-]{8,}\b")
NETNS_ENV = "HTP_CODEX_OAUTH_NETNS"


def sanitize(text):
    text = SECRET_RE.sub(lambda m: m.group(1) + "=REDACTED", text)
    text = TOKEN_RE.sub("REDACTED", text)
    return text


def reexec_in_netns():
    """Run this script under `unshare -rn` with loopback if not already isolated."""
    if os.environ.get(NETNS_ENV) == "1":
        return
    if not shutil.which("unshare"):
        raise SystemExit("unshare is required for the loopback-only network namespace; "
                         "pass --already-isolated only inside an equivalent sandbox")
    inner = "ip link set lo up; " + NETNS_ENV + "=1 exec " + " ".join(
        shlex.quote(arg) for arg in [sys.executable, __file__, *sys.argv[1:]]
    )
    os.execvp("unshare", ["unshare", "-rn", "sh", "-c", inner])


def make_env(root: Path) -> dict:
    subdirs = ["home", "codex-home", "tmp", "cwd", "run", "xdg-config", "xdg-cache", "xdg-data", "xdg-state"]
    for sub in subdirs:
        path = root / sub
        path.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    os.chmod(root / "run", 0o700)
    (root / "codex-home" / "config.toml").write_text(
        'mcp_oauth_credentials_store = "file"\n', encoding="utf-8"
    )
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(root / "home"),
        "CODEX_HOME": str(root / "codex-home"),
        "TMPDIR": str(root / "tmp"),
        "XDG_CONFIG_HOME": str(root / "xdg-config"),
        "XDG_CACHE_HOME": str(root / "xdg-cache"),
        "XDG_DATA_HOME": str(root / "xdg-data"),
        "XDG_STATE_HOME": str(root / "xdg-state"),
        "XDG_RUNTIME_DIR": str(root / "run"),
        "LANG": "C.UTF-8",
    }


class Fixture:
    def __init__(self, root: Path, decision: str):
        self.log = root / "fixture.jsonl"
        env = dict(os.environ)
        env["FIXTURE_LOG"] = str(self.log)
        env["FIXTURE_PORT"] = "0"
        env["FIXTURE_DECISION"] = decision
        self.proc = subprocess.Popen(
            ["node", str(FIXTURE)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, text=True
        )
        ready = self.proc.stdout.readline()
        match = re.search(r"FIXTURE_READY port=(\d+)", ready or "")
        if not match:
            raise RuntimeError(f"fixture did not report readiness: {ready!r}")
        self.port = int(match.group(1))
        self.url = f"http://127.0.0.1:{self.port}/mcp"

    def events(self) -> list:
        found = []
        if self.log.exists():
            for line in self.log.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "event" in obj:
                    found.append(obj["event"])
        return found

    def stop(self):
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)


def http_get_follow(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "synthetic-fixture-browser"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.geturl(), response.status
    except urllib.error.HTTPError as error:
        return error.geturl(), error.code


def drive_codex_oauth(env: dict, root: Path, args: list, timeout: float = 45.0):
    """Run a blocking `codex mcp ...` OAuth command and complete every printed
    authorization URL against the fixture. Returns (exit_code, sanitized_output)."""
    proc = subprocess.Popen(
        ["codex", *args], env=env, cwd=str(root / "cwd"),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=False,
    )
    buffer = b""
    seen = set()
    start = time.time()
    try:
        while time.time() - start < timeout:
            ready, _, _ = select.select([proc.stdout], [], [], 0.5)
            if ready:
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break
                buffer += chunk
                text = buffer.decode("utf-8", "replace")
                for match in AUTHORIZE_RE.finditer(text):
                    url = match.group(0)
                    if url not in seen:
                        seen.add(url)
                        final, status = http_get_follow(url)
                        buffer += f"\n[driver] authorize -> {status} {final}\n".encode()
            if proc.poll() is not None:
                break
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()
    return proc.returncode, sanitize(buffer.decode("utf-8", "replace"))


def run_codex(env: dict, root: Path, args: list, timeout: float = 30.0):
    result = subprocess.run(
        ["codex", *args], env=env, cwd=str(root / "cwd"),
        capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
    )
    return result.returncode, sanitize(result.stdout or ""), sanitize(result.stderr or "")


class AppServer:
    def __init__(self, env: dict):
        self.proc = subprocess.Popen(
            ["codex", "app-server"], env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0,
        )
        self._id = 0

    def _send(self, message: dict):
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        self.proc.stdin.flush()

    def request(self, method: str, params: dict, timeout: float = 60.0):
        self._id += 1
        ident = self._id
        self._send({"jsonrpc": "2.0", "id": ident, "method": method, "params": params})
        buffer = b""
        while True:
            ready, _, _ = select.select([self.proc.stdout], [], [], timeout)
            if not ready:
                raise TimeoutError(f"timed out waiting for {method}")
            chunk = os.read(self.proc.stdout.fileno(), 1)
            if not chunk:
                raise RuntimeError(f"app-server closed during {method}")
            if chunk != b"\n":
                buffer += chunk
                continue
            message = json.loads(buffer)
            buffer = b""
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message["result"]

    def notify(self, method: str, params: dict):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def mcp_status(self, server_name: str):
        return self.request("mcpServerStatus/list", {"serverName": server_name})

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def credential_files(codex_home: Path):
    found = []
    for path in sorted(codex_home.rglob("*")):
        if path.is_file() and path.name != "config.toml" and path.suffix in (".json", ".age"):
            found.append(path)
    return found


def status_assertions(status: dict, expect_authenticated: bool) -> dict:
    by_name = {item.get("name"): item for item in status.get("data", [])}
    server = by_name.get(SERVER_NAME, {})
    tools = set((server.get("tools") or {}).keys())
    return {
        "authStatus": server.get("authStatus"),
        "runtimeStatus": server.get("runtimeStatus"),
        "toolsErrorPresent": bool(server.get("toolsError")),
        "tools": sorted(tools),
        "hasExpectedTools": tools == EXPECTED_TOOLS,
        "expectAuthenticated": expect_authenticated,
    }


def scenario_approve(env: dict, root: Path, fixture: Fixture) -> dict:
    result = {}
    rc, output = drive_codex_oauth(env, root, ["mcp", "add", SERVER_NAME, "--url", fixture.url])
    result["addExitCode"] = rc
    result["addLoggedIn"] = "Successfully logged in" in output
    result["addOutput"] = output

    rc, listing, _ = run_codex(env, root, ["mcp", "list", "--json"])
    parsed = json.loads(listing)
    result["listAuthStatusAfterAdd"] = parsed[0].get("auth_status") if parsed else None

    credentials = credential_files(root / "codex-home")
    result["credentialFiles"] = [str(p.relative_to(root / "codex-home")) for p in credentials]
    result["credentialMode"] = oct(credentials[0].stat().st_mode & 0o777) if credentials else None

    app = AppServer(env)
    try:
        app.request("initialize", {"clientInfo": {"name": "htp-oauth-smoke", "version": "1"}})
        app.notify("initialized", {})
        result["statusAfterLogin"] = status_assertions(app.mcp_status(SERVER_NAME), expect_authenticated=True)
    finally:
        app.close()

    # Reconnect through the documented `mcp login` path after an explicit logout.
    rc, logout, _ = run_codex(env, root, ["mcp", "logout", SERVER_NAME])
    result["logoutExitCode"] = rc
    result["logoutRemoved"] = "Removed OAuth credentials" in logout
    rc, listing, _ = run_codex(env, root, ["mcp", "list", "--json"])
    parsed = json.loads(listing)
    result["listAuthStatusAfterLogout"] = parsed[0].get("auth_status") if parsed else None
    result["credentialFilesAfterLogout"] = [str(p.relative_to(root / "codex-home")) for p in credential_files(root / "codex-home")]

    app = AppServer(env)
    try:
        app.request("initialize", {"clientInfo": {"name": "htp-oauth-smoke", "version": "1"}})
        app.notify("initialized", {})
        result["statusAfterLogout"] = status_assertions(app.mcp_status(SERVER_NAME), expect_authenticated=False)
    finally:
        app.close()

    rc, output = drive_codex_oauth(env, root, ["mcp", "login", SERVER_NAME])
    result["loginExitCode"] = rc
    result["loginLoggedIn"] = "Successfully logged in" in output
    result["loginOutput"] = output
    rc, listing, _ = run_codex(env, root, ["mcp", "list", "--json"])
    parsed = json.loads(listing)
    result["listAuthStatusAfterLogin"] = parsed[0].get("auth_status") if parsed else None

    # Final cleanup logout in this disposable profile.
    run_codex(env, root, ["mcp", "logout", SERVER_NAME])
    return result


def scenario_deny(env: dict, root: Path, fixture: Fixture) -> dict:
    result = {}
    rc, output = drive_codex_oauth(env, root, ["mcp", "add", SERVER_NAME, "--url", fixture.url])
    result["addExitCode"] = rc
    result["providerDenied"] = "access_denied" in output
    result["addOutput"] = output

    rc, listing, _ = run_codex(env, root, ["mcp", "list", "--json"])
    parsed = json.loads(listing)
    result["listAuthStatusAfterDeny"] = parsed[0].get("auth_status") if parsed else None
    result["credentialFilesAfterDeny"] = [str(p.relative_to(root / "codex-home")) for p in credential_files(root / "codex-home")]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=["approve", "deny"])
    parser.add_argument("--summary", help="optional path for a sanitized JSON summary")
    parser.add_argument("--already-isolated", action="store_true",
                        help="skip the automatic `unshare -rn` wrapper (caller guarantees loopback-only)")
    args = parser.parse_args()

    if args.already_isolated:
        os.environ[NETNS_ENV] = "1"
    reexec_in_netns()

    if not shutil.which("codex"):
        raise SystemExit("codex CLI is not on PATH")
    if not FIXTURE.is_file():
        raise SystemExit(f"fixture not found: {FIXTURE}")

    version = subprocess.run(["codex", "--version"], capture_output=True, text=True).stdout.strip()
    root = Path(tempfile.mkdtemp(prefix="htp-codex-oauth-smoke-"))
    try:
        os.chmod(root, 0o700)
        env = make_env(root)
        fixture = Fixture(root, "approve" if args.scenario == "approve" else "deny")
        try:
            if args.scenario == "approve":
                result = scenario_approve(env, root, fixture)
                events = fixture.events()
                checks = {
                    "add_exit_0": result["addExitCode"] == 0,
                    "add_logged_in": result["addLoggedIn"],
                    "list_o_auth": result["listAuthStatusAfterAdd"] == "o_auth",
                    "credential_file_0600": result["credentialMode"] == "0o600",
                    "status_o_auth": result["statusAfterLogin"]["authStatus"] == "oAuth",
                    "status_tools": result["statusAfterLogin"]["hasExpectedTools"],
                    "status_no_error": not result["statusAfterLogin"]["toolsErrorPresent"],
                    "authorized_call_seen": "mcp_authorized_call" in events,
                    "logout_removed": result["logoutRemoved"],
                    "list_not_logged_in": result["listAuthStatusAfterLogout"] == "not_logged_in",
                    "credentials_gone": not result["credentialFilesAfterLogout"],
                    "status_auth_required": result["statusAfterLogout"]["authStatus"] != "oAuth",
                    "login_exit_0": result["loginExitCode"] == 0,
                    "login_logged_in": result["loginLoggedIn"],
                    "relogin_o_auth": result["listAuthStatusAfterLogin"] == "o_auth",
                }
            else:
                result = scenario_deny(env, root, fixture)
                events = fixture.events()
                checks = {
                    "add_exit_nonzero": result["addExitCode"] not in (0, None),
                    "provider_denied": result["providerDenied"],
                    "list_not_logged_in": result["listAuthStatusAfterDeny"] == "not_logged_in",
                    "no_credentials": not result["credentialFilesAfterDeny"],
                    "deny_seen": "authorize_denied" in events,
                }
            result["hostVersion"] = version
            result["scenario"] = args.scenario
            result["fixtureEvents"] = events
            result["checks"] = checks
            result["passed"] = all(checks.values())
        finally:
            fixture.stop()
        if args.summary:
            Path(args.summary).write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
        summary = {k: v for k, v in result.items() if k not in ("addOutput", "loginOutput")}
        print(json.dumps(summary, indent=2, sort_keys=True))
        if not result["passed"]:
            failed = [name for name, ok in result["checks"].items() if not ok]
            raise SystemExit(f"FAILED {args.scenario}: {', '.join(failed)}")
        print(f"PASS: Codex CLI OAuth {args.scenario} scenario against loopback fixture.")
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
