#!/usr/bin/env python3
"""Optional real Codex CLI smoke; uses a temporary home and no account credentials."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {"htp:repository-settings", "htp:seo-review", "htp:website-management", "htp:seosmith-operations"}

with tempfile.TemporaryDirectory(prefix="htp-codex-smoke-") as home:
    env = {**os.environ, "CODEX_HOME": home}
    def cli(*args):
        subprocess.run(["codex", "plugin", *args], env=env, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    cli("marketplace", "add", str(ROOT))
    cli("add", "htp@htp-codex")
    proc = subprocess.Popen(["codex", "app-server"], env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    def send(message):
        proc.stdin.write(json.dumps(message) + "\n")
        proc.stdin.flush()
    def response(ident):
        # Unbuffered OS reads avoid select() missing lines held by a text buffer.
        data = b""
        while True:
            ready, _, _ = select.select([proc.stdout.fileno()], [], [], 30)
            if not ready:
                raise TimeoutError("Codex app-server response timed out")
            chunk = os.read(proc.stdout.fileno(), 1)
            if not chunk:
                raise RuntimeError("Codex app-server closed its output")
            if chunk != b"\n":
                data += chunk
                continue
            message = json.loads(data)
            data = b""
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message["result"]
    try:
        send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "htp-host-smoke", "version": "1"}}})
        response(1)
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "skills/list", "params": {"cwds": [str(ROOT)], "forceReload": True}})
        result = response(2)
        installed = Path(home) / "plugins" / "cache" / "htp-codex" / "htp"
        found = set()
        for group in result["data"]:
            if group.get("errors"):
                raise RuntimeError("Skill discovery reported errors")
            for skill in group["skills"]:
                if Path(skill["path"]).is_relative_to(installed):
                    found.add(skill["name"])
        if found != EXPECTED:
            raise AssertionError(f"Installed skills differ: {found!r}")
        print("Codex app-server discovered all four installed HTP skills; no services or agent turns invoked.")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
