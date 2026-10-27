"""
agentdesk.server: Zero-dependency HTTP & SSE server bridging Herdr multiplexer,
                  AgentR multi-agent intelligence, and mobile cockpit clients.
"""
from __future__ import annotations

import json
import mimetypes
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from typing import Optional, Dict, Any

from .herdr_bridge import HerdrBridge
from .agentr_bridge import AgentRBridge

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(HERE)
WEB_DIR = os.path.join(ROOT_DIR, "web")
CONFIG_DIR = os.path.expanduser("~/.config/agentdesk")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
LEGACY_CONFIG = "/home/ashish/Work/tries/herdr-phone/.herdr-phone.json"


def load_config() -> Dict[str, Any]:
    cfg = {
        "bind": "0.0.0.0",
        "port": 9876,
        "secret": "",
        "socket": os.path.expanduser("~/.config/herdr/herdr.sock"),
        "workspace": "/home/ashish/Work",
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception:
            pass
    elif os.path.exists(LEGACY_CONFIG):
        try:
            with open(LEGACY_CONFIG, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("secret"):
                    cfg["secret"] = data["secret"]
                if data.get("socket"):
                    cfg["socket"] = data["socket"]
        except Exception:
            pass
    return cfg


CONFIG = load_config()
HERDR = HerdrBridge(CONFIG.get("socket"))
AGENTR = AgentRBridge(CONFIG.get("workspace"))


class AgentDeskHandler(BaseHTTPRequestHandler):
    server_version = "AgentDesk/0.1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Minimal quiet logging
        if sys.stderr and not sys.stderr.closed:
            sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} {args[1]} -> {args[2]}\n")

    def _send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def check_auth(self) -> bool:
        secret = CONFIG.get("secret", "").strip()
        if not secret:
            return True

        # Check URL query param: ?secret=...
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if qs.get("secret", [""])[0] == secret:
            return True

        # Check Authorization header: Bearer <secret>
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and auth[7:].strip() == secret:
            return True

        return False

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message: str, status: int = 400) -> None:
        self.send_json({"error": message, "status": status}, status=status)

    def read_post_json(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw) if raw else {}
        except Exception as e:
            return {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Authenticate all API endpoints and non-public files
        if not self.check_auth():
            self.send_error_json("Unauthorized: valid ?secret= required", 401)
            return

        # API: Real-time Herdr snapshot
        if path in ("/api/status", "/snapshot.json"):
            snap = HERDR.get_snapshot()
            self.send_json({"status": "ok", "snapshot": snap})
            return

        # API: Read specific pane terminal output
        if path.startswith("/api/pane/") and path.endswith("/read"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                pane_id = parts[2]
                lines_str = qs.get("lines", ["80"])[0]
                lines = int(lines_str) if lines_str.isdigit() else 80
                output = HERDR.read_pane(pane_id, lines=lines)
                self.send_json({"pane_id": pane_id, "output": output})
                return

        # API: Unified recent sessions via AgentR
        if path == "/api/sessions":
            agent_filter = qs.get("agent", [None])[0]
            limit_str = qs.get("limit", ["50"])[0]
            limit = int(limit_str) if limit_str.isdigit() else 50
            sessions = AGENTR.list_sessions(filter_agent=agent_filter, limit=limit)
            self.send_json({"status": "ok", "sessions": sessions})
            return

        # API: Session transcript details via AgentR
        if path == "/api/sessions/details":
            agent = qs.get("agent", [""])[0]
            cid = qs.get("cid", [""])[0]
            if not agent or not cid:
                self.send_error_json("Missing 'agent' or 'cid' param")
                return
            try:
                details = AGENTR.get_session_details(agent, cid)
                self.send_json({"status": "ok", "details": details})
            except Exception as e:
                self.send_error_json(str(e), 404)
            return

        # API: Deep search across all agent sessions
        if path == "/api/search":
            q = qs.get("q", [""])[0]
            agent_filter = qs.get("agent", [None])[0]
            if not q:
                self.send_json({"status": "ok", "results": []})
                return
            results = AGENTR.search_sessions(q, filter_agent=agent_filter)
            self.send_json({"status": "ok", "query": q, "results": results})
            return

        # API: AgentR coordination board
        if path == "/api/board":
            board = AGENTR.get_board()
            self.send_json({"status": "ok", "board": board})
            return

        # API: Real-time Server-Sent Events (SSE)
        if path == "/api/events" or path == "/events":
            self.handle_sse()
            return

        # Static Web File Serving
        self.serve_static(path)

    def do_POST(self) -> None:
        if not self.check_auth():
            self.send_error_json("Unauthorized: valid ?secret= required", 401)
            return

        parsed = urlparse(self.path)
        path = parsed.path
        body = self.read_post_json()

        # API: Send input or approval to a Herdr pane
        if path == "/api/interact" or (path.startswith("/api/pane/") and path.endswith("/send")):
            pane_id = body.get("pane_id")
            if not pane_id and path.startswith("/api/pane/"):
                pane_id = path.strip("/").split("/")[2]
            text = body.get("text", "")
            submit = body.get("submit", True)
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            ok = HERDR.send_input(pane_id, text, submit=submit)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id})
            return

        # API: Quick-approve button (sends 'y\n' or custom approval)
        if path == "/api/approve":
            pane_id = body.get("pane_id")
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            ok = HERDR.send_input(pane_id, "y\n", submit=True)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "approved": True})
            return

        # API: Cross-agent handoff trigger
        if path == "/api/handoff":
            agent = body.get("agent", "")
            cid = body.get("cid", "")
            target = body.get("target", "")
            if not agent or not cid or not target:
                self.send_error_json("Missing 'agent', 'cid', or 'target'")
                return
            try:
                res = AGENTR.execute_handoff(agent, cid, target)
                self.send_json(res)
            except Exception as e:
                self.send_error_json(str(e), 500)
            return

        # API: AgentR board task update
        if path == "/api/board/task/update":
            tid = body.get("id", "")
            status = body.get("status", "")
            if not tid or not status:
                self.send_error_json("Missing 'id' or 'status'")
                return
            ok = AGENTR.update_board_task(tid, status)
            self.send_json({"status": "ok" if ok else "not_found", "id": tid})
            return

        # API: AgentR board task add
        if path == "/api/board/task/add":
            title = body.get("title", "")
            desc = body.get("description", "")
            agent = body.get("agent", "agy")
            review_by = body.get("review_by", "grok")
            if not title:
                self.send_error_json("Missing task 'title'")
                return
            tid = AGENTR.add_board_task(title, description=desc, agent=agent, review_by=review_by)
            self.send_json({"status": "ok", "id": tid})
            return

        # API: AgentR board feedback add
        if path == "/api/board/feedback":
            text = body.get("text", "")
            agent = body.get("agent", "mobile")
            if not text:
                self.send_error_json("Missing feedback 'text'")
                return
            AGENTR.add_board_feedback(text, agent=agent)
            self.send_json({"status": "ok"})
            return

        self.send_error_json("Endpoint not found", 404)

    def handle_sse(self) -> None:
        self.send_response(200)
        self._send_cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        # Send initial connection event + snapshot
        init_event = json.dumps({"type": "init", "time": time.time(), "snapshot": HERDR.get_snapshot()})
        self.wfile.write(f"data: {init_event}\n\n".encode("utf-8"))
        self.wfile.flush()

        last_state: Dict[str, str] = {}
        counter = 0

        try:
            while True:
                time.sleep(1.5)
                counter += 1
                snap = HERDR.get_snapshot()
                agents = snap.get("agents", [])
                panes = snap.get("panes", [])

                # Detect state transitions (e.g. idle -> working, working -> blocked)
                changed = []
                for p in panes:
                    pid = p.get("pane_id", "")
                    curr_st = p.get("agent_status") or "unknown"
                    prev_st = last_state.get(pid)
                    if prev_st is not None and prev_st != curr_st:
                        changed.append({
                            "pane_id": pid,
                            "agent": p.get("agent") or p.get("display_agent") or "unknown",
                            "title": p.get("terminal_title_stripped") or p.get("terminal_title") or "",
                            "from": prev_st,
                            "to": curr_st,
                        })
                    last_state[pid] = curr_st

                if changed:
                    ev = json.dumps({"type": "state_change", "changes": changed, "time": time.time()})
                    self.wfile.write(f"data: {ev}\n\n".encode("utf-8"))
                    self.wfile.flush()

                # Send periodic heartbeat or full sync
                if counter % 4 == 0:
                    sync_ev = json.dumps({"type": "sync", "snapshot": snap, "time": time.time()})
                    self.wfile.write(f"data: {sync_ev}\n\n".encode("utf-8"))
                    self.wfile.flush()

        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def serve_static(self, path: str) -> None:
        clean = path.strip("/")
        if not clean or clean == "index.html":
            filename = "index.html"
        else:
            filename = clean

        target = os.path.realpath(os.path.join(WEB_DIR, filename))
        if not target.startswith(os.path.realpath(WEB_DIR)) or not os.path.exists(target):
            self.send_error_json(f"File not found: {filename}", 404)
            return

        mime_type, _ = mimetypes.guess_type(target)
        if not mime_type:
            mime_type = "application/octet-stream"

        try:
            with open(target, "rb") as f:
                content = f.read()
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(f"Failed to read file: {e}", 500)


def run_server(bind: str = "0.0.0.0", port: int = 9876) -> None:
    signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
    signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))

    server_address = (bind, port)
    httpd = ThreadingHTTPServer(server_address, AgentDeskHandler)
    print(f"AgentDesk daemon listening on http://{bind}:{port}")
    print(f"  Herdr Socket : {CONFIG.get('socket')}")
    print(f"  Web Assets   : {WEB_DIR}")
    print(f"  Secret Auth  : {'ENABLED' if CONFIG.get('secret') else 'NONE (Open)'}")

    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


if __name__ == "__main__":
    b = CONFIG.get("bind", "0.0.0.0")
    p = int(CONFIG.get("port", 9876))
    run_server(b, p)
