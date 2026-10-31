"""
agentdesk.server: Clean, zero-dependency HTTP & SSE server bridging Herdr multiplexer,
AgentR multi-agent intelligence, and mobile/desktop cockpit clients.
"""
from __future__ import annotations

import json
import mimetypes
import os
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from typing import Optional, Dict, Any, List

from .herdr_bridge import HerdrBridge
from .agentr_bridge import AgentRBridge
from .config import load_config, check_auth, CONFIG_FILE, CONFIG_DIR, LEGACY_CONFIG
from .watchdog import AutonomousWatchdog
from .events import get_enriched_snapshot, stream_dashboard_events, stream_pane_terminal
from .api_routes import handle_api_get, handle_api_post

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(HERE)
WEB_DIR = os.path.join(ROOT_DIR, "web")

CONFIG = load_config()
HERDR = HerdrBridge(CONFIG.get("socket"))
AGENTR = AgentRBridge(CONFIG.get("workspace"))
WATCHDOG = AutonomousWatchdog(HERDR, AGENTR)


class AgentDeskHandler(BaseHTTPRequestHandler):
    server_version = "AgentDesk/0.2.0"

    def log_message(self, format: str, *args: Any) -> None:
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
        return check_auth(self.path, self.headers, CONFIG.get("secret", "").strip())

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
        except Exception:
            return {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Authenticate all /api requests
        if path.startswith("/api/"):
            if not self.check_auth():
                self.send_error_json("Unauthorized: valid ?secret= required", 401)
                return

            if handle_api_get(self, path, qs, HERDR, AGENTR, WATCHDOG):
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

        if handle_api_post(self, path, body, HERDR, AGENTR, WATCHDOG):
            return

        self.send_error_json("Endpoint not found", 404)

    def handle_sse(self) -> None:
        stream_dashboard_events(self, HERDR, AGENTR, WATCHDOG)

    def handle_pane_sse_stream(self, pane_id: str, lines: int = 120) -> None:
        stream_pane_terminal(self, HERDR, pane_id, lines=lines)

    def serve_static(self, path: str) -> None:
        if path in ("/", ""):
            filename = "index.html"
        else:
            filename = path.lstrip("/")

        target = os.path.abspath(os.path.join(WEB_DIR, filename))
        if not target.startswith(os.path.abspath(WEB_DIR)):
            self.send_error_json("Forbidden", 403)
            return

        if not os.path.isfile(target):
            # Fall back to index.html for SPA routing
            target = os.path.join(WEB_DIR, "index.html")

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
            secret = CONFIG.get("secret", "").strip()
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            if secret and (self.check_auth() or qs.get("secret", [""])[0] == secret):
                self.send_header("Set-Cookie", f"agentdesk_secret={secret}; Path=/; Max-Age=31536000; SameSite=Lax")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(f"Failed to read file: {e}", 500)


def run_server(bind: str = "0.0.0.0", port: int = 9876) -> None:
    global CONFIG, HERDR, AGENTR, WATCHDOG
    CONFIG = load_config()
    bind = CONFIG.get("bind", bind)
    port = int(CONFIG.get("port", port))
    HERDR = HerdrBridge(CONFIG.get("socket"))
    AGENTR = AgentRBridge(CONFIG.get("workspace"))
    WATCHDOG = AutonomousWatchdog(HERDR, AGENTR)

    # Start autonomous background watchdog
    WATCHDOG.start()

    server = ThreadingHTTPServer((bind, port), AgentDeskHandler)
    server.daemon_threads = True

    def _sig_handler(sig: int, frame: Any) -> None:
        print("\nShutting down AgentDesk server...")
        try:
            server.server_close()
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    print(f"AgentDesk server listening on http://{bind}:{port}")
    print(f"Herdr socket: {CONFIG.get('socket')}")
    print(f"AgentR workspace: {CONFIG.get('workspace')}")
    if CONFIG.get("secret"):
        print(f"Auth secret active (pass ?secret=... or Authorization: Bearer ...)")
    else:
        print("WARNING: No secret configured; public access open")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    b = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
    p = int(sys.argv[2]) if len(sys.argv) > 2 else 9876
    run_server(bind=b, port=p)
