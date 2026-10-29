"""
agentdesk.herdr_bridge: Socket & CLI interface to the local Herdr multiplexer.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time
from typing import Optional, Dict, Any, List

DEFAULT_SOCK = os.path.expanduser("~/.config/herdr/herdr.sock")


class HerdrBridge:
    def __init__(self, sock_path: str = DEFAULT_SOCK):
        self.sock_path = sock_path

    def is_available(self) -> bool:
        return os.path.exists(self.sock_path)

    def _call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 4.0) -> Dict[str, Any]:
        payload = {"id": f"desk-{time.time()}", "method": method, "params": params or {}}
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect(self.sock_path)
            s.sendall((json.dumps(payload) + "\n").encode())
            chunks = []
            while True:
                try:
                    chunk = s.recv(65536)
                except (socket.timeout, OSError):
                    break
                if not chunk:
                    break
                chunks.append(chunk)
                if b"\n" in chunk:
                    break
        finally:
            try:
                s.close()
            except OSError:
                pass

        raw = b"".join(chunks).decode(errors="replace").strip()
        if not raw:
            raise RuntimeError("Herdr socket returned empty response")
        parsed = json.loads(raw)
        if "error" in parsed:
            err = parsed["error"]
            raise RuntimeError(f"Herdr error {err.get('code')}: {err.get('message')}")
        return parsed.get("result", {})

    def get_snapshot(self) -> Dict[str, Any]:
        """Fetch current session snapshot: workspaces, tabs, panes, and agents."""
        if not self.is_available():
            return {"error": "Herdr socket not found at " + self.sock_path, "agents": [], "panes": []}
        try:
            res = self._call("session.snapshot")
            return res.get("snapshot", res)
        except Exception as e:
            # Fallback to CLI
            try:
                out = subprocess.run(["herdr", "status", "server"], capture_output=True, text=True, timeout=3)
                return {"status": out.stdout.strip(), "error": str(e), "panes": []}
            except Exception:
                return {"error": str(e), "panes": [], "agents": []}

    def read_pane(self, pane_id: str, lines: int = 100) -> str:
        """Read recent unwrapped terminal output from a pane."""
        try:
            res = subprocess.run(
                ["herdr", "pane", "read", pane_id, "--source", "recent-unwrapped", "--lines", str(lines)],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0:
                return res.stdout
            return res.stderr or f"Error reading pane {pane_id}"
        except Exception as e:
            return f"Failed to read pane: {e}"

    def send_input(self, pane_id: str, text: str, submit: bool = True) -> bool:
        """Send text or approval command to a pane.

        If submit is True, sends text followed by Enter key press to submit the prompt.
        """
        clean_text = text.rstrip("\r\n")
        try:
            # 1. Try Herdr socket RPC if socket is active
            if self.is_available():
                try:
                    if clean_text:
                        self._call("pane.send_text", {"pane_id": pane_id, "text": clean_text})
                    if submit:
                        self._call("pane.send_keys", {"pane_id": pane_id, "keys": ["enter"]})
                    return True
                except Exception:
                    pass

            # 2. Fallback to CLI
            if clean_text:
                res1 = subprocess.run(
                    ["herdr", "pane", "send-text", pane_id, clean_text],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                if res1.returncode != 0:
                    return False
            if submit:
                res2 = subprocess.run(
                    ["herdr", "pane", "send-keys", pane_id, "enter"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                return res2.returncode == 0
            return True
        except Exception:
            return False

    def send_keys(self, pane_id: str, keys: List[str]) -> bool:
        """Send specific control keys (e.g. ['enter'], ['ctrl+c'], ['esc'])."""
        if not keys:
            return True
        try:
            # 1. Try Herdr socket RPC if socket is active
            if self.is_available():
                try:
                    self._call("pane.send_keys", {"pane_id": pane_id, "keys": keys})
                    return True
                except Exception:
                    pass

            # 2. Fallback to CLI
            cmd = ["herdr", "pane", "send-keys", pane_id] + keys
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            return res.returncode == 0
        except Exception:
            return False

    def subscribe(self, subscription_types: Optional[List[str]] = None) -> socket.socket:
        """Open a long-lived socket for Herdr events."""
        types = subscription_types or ["pane.output", "agent.state", "workspace.state"]
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect(self.sock_path)
        sub = {
            "id": f"sub-{time.time()}",
            "method": "events.subscribe",
            "params": {"subscriptions": [{"type": t} for t in types]},
        }
        s.sendall((json.dumps(sub) + "\n").encode())
        # consume ack
        try:
            s.recv(4096)
        except (socket.timeout, OSError):
            pass
        s.settimeout(None)
        return s
