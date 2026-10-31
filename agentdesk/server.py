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
from urllib.parse import urlparse, parse_qs, unquote
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


class AutonomousWatchdog:
    """Monitors running agent panes, tracks execution durations, estimates token metrics, and emits lifecycle alerts."""
    def __init__(self, herdr: Optional[HerdrBridge] = None, agentr: Optional[AgentRBridge] = None):
        self.herdr = herdr
        self.agentr = agentr
        self.active_runs: Dict[str, Dict[str, Any]] = {}
        self.recent_completions: List[Dict[str, Any]] = []
        self.pane_states: Dict[str, str] = {}
        self.alert_events: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._running = True

    def start(self) -> None:
        t = threading.Thread(target=self._loop, daemon=True, name="agentdesk-watchdog")
        t.start()

    def _loop(self) -> None:
        while self._running:
            try:
                self.poll()
            except Exception:
                pass
            time.sleep(3.0)

    def poll(self) -> None:
        if self.herdr:
            snap = self.herdr.get_snapshot()
            panes = snap.get("panes", [])
        else:
            panes = []
        self.update(panes)

    def update(self, panes: List[Dict[str, Any]], now: Optional[float] = None) -> None:
        if now is None:
            now = time.time()

        with self._lock:
            current_ids = set()
            for p in panes:
                pid = p.get("pane_id")
                if not pid:
                    continue
                current_ids.add(pid)
                status = p.get("agent_status", "idle")
                agent = p.get("agent") or p.get("display_agent", "terminal")
                ws = p.get("workspace_name", "~")
                prev_status = self.pane_states.get(pid, "unknown")
                self.pane_states[pid] = status

                # Transition into working
                if status == "working":
                    if pid not in self.active_runs:
                        self.active_runs[pid] = {
                            "pane_id": pid,
                            "agent": agent,
                            "workspace": ws,
                            "started_at": now,
                            "last_change_at": now,
                            "turns": 1,
                            "estimated_tokens": 1500,
                        }
                    else:
                        run = self.active_runs[pid]
                        elapsed = now - run["started_at"]
                        run["turns"] = max(run["turns"], int(elapsed // 25) + 1)
                        run["estimated_tokens"] = run["turns"] * 1250

                # Transition from working to done or idle
                elif prev_status == "working" and status in ("done", "idle"):
                    if pid in self.active_runs:
                        run = self.active_runs.pop(pid)
                        duration = int(now - run["started_at"])
                        mins = duration // 60
                        secs = duration % 60
                        dur_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"

                        completion = {
                            "pane_id": pid,
                            "agent": agent,
                            "workspace": ws,
                            "duration_seconds": duration,
                            "duration_str": dur_str,
                            "turns": run["turns"],
                            "estimated_tokens": run["estimated_tokens"],
                            "completed_at": now,
                        }
                        self.recent_completions.insert(0, completion)
                        if len(self.recent_completions) > 20:
                            self.recent_completions.pop()

                        self.alert_events.append({
                            "type": "run.completed",
                            "pane_id": pid,
                            "agent": agent,
                            "workspace": ws,
                            "duration": dur_str,
                            "text": f"🎉 {agent.upper()} in {ws} finished in {dur_str}!",
                        })

                # Transition into blocked (needs approval)
                if status == "blocked" and prev_status != "blocked":
                    self.alert_events.append({
                        "type": "agent.blocked",
                        "pane_id": pid,
                        "agent": agent,
                        "workspace": ws,
                        "text": f"⚠️ {agent.upper()} in {ws} needs tool approval!",
                    })

            # Clean dead runs
            for pid in list(self.active_runs.keys()):
                if pid not in current_ids:
                    self.active_runs.pop(pid, None)

    def get_telemetry(self, pane_id: str) -> Dict[str, Any]:
        with self._lock:
            if pane_id in self.active_runs:
                r = self.active_runs[pane_id]
                elapsed = int(time.time() - r["started_at"])
                mins = elapsed // 60
                secs = elapsed % 60
                return {
                    "is_running": True,
                    "elapsed_seconds": elapsed,
                    "duration_str": f"{mins}m {secs}s" if mins > 0 else f"{secs}s",
                    "turns": r["turns"],
                    "estimated_tokens": r["estimated_tokens"],
                }
            for c in self.recent_completions:
                if c["pane_id"] == pane_id:
                    return {
                        "is_running": False,
                        "duration_str": c["duration_str"],
                        "turns": c["turns"],
                        "estimated_tokens": c["estimated_tokens"],
                        "completed_at": c["completed_at"],
                    }
        return {"is_running": False, "turns": 0, "estimated_tokens": 0}

    def pop_alerts(self) -> List[Dict[str, Any]]:
        with self._lock:
            alerts = list(self.alert_events)
            self.alert_events.clear()
            return alerts


WATCHDOG = AutonomousWatchdog(HERDR, AGENTR)


SESSION_DETAILS_CACHE: Dict[str, Dict[str, Any]] = {}
SESSION_DETAILS_TIME = 0.0


def get_enriched_snapshot() -> Dict[str, Any]:
    global SESSION_DETAILS_CACHE, SESSION_DETAILS_TIME
    snap = HERDR.get_snapshot()
    panes = snap.get("panes", [])
    now = time.time()

    # Refresh session mapping cache every 4 seconds
    if now - SESSION_DETAILS_TIME > 4.0 or not SESSION_DETAILS_CACHE:
        try:
            sessions = AGENTR.list_sessions(limit=50)
            new_cache: Dict[str, Dict[str, Any]] = {}
            for s in sessions:
                cid = s.get("cid")
                if cid:
                    new_cache[cid] = {
                        "title": s.get("title", ""),
                        "snippet": s.get("snippet", ""),
                        "agent": s.get("agent", ""),
                        "workdir": s.get("workdir", ""),
                    }
            SESSION_DETAILS_CACHE = new_cache
            SESSION_DETAILS_TIME = now
        except Exception:
            pass

    for p in panes:
        pid = p.get("pane_id")
        if not pid:
            continue
        p["telemetry"] = WATCHDOG.get_telemetry(pid)

        sess_obj = p.get("agent_session") or {}
        cid = sess_obj.get("value")
        chat_title = None
        last_context = ""

        if cid and cid in SESSION_DETAILS_CACHE:
            s_info = SESSION_DETAILS_CACHE[cid]
            chat_title = s_info.get("title")
            last_context = s_info.get("snippet")

        if not chat_title:
            ws_label = p.get("workspace_name")
            ag = p.get("agent") or p.get("display_agent")
            raw_title = p.get("terminal_title_stripped") or p.get("terminal_title") or ""
            if "@" in raw_title and ":" in raw_title:
                path_part = raw_title.split(":", 1)[1]
                chat_title = f"Terminal ({path_part})"
            elif raw_title and raw_title not in ("zsh", "bash"):
                chat_title = raw_title
            elif ag and ws_label:
                chat_title = f"{ag.upper()} in {ws_label}"
            else:
                chat_title = f"Pane {pid}"

        p["chat_title"] = chat_title
        p["last_context"] = last_context

    return snap


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

        # Check Cookie: agentdesk_secret=<secret>
        cookie_header = self.headers.get("Cookie", "")
        for item in cookie_header.split(";"):
            item = item.strip()
            if item.startswith("agentdesk_secret="):
                val = item[len("agentdesk_secret="):].strip()
                if val == secret:
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

        is_api = path.startswith("/api/") or path in ("/snapshot.json", "/events")

        if is_api:
            if not self.check_auth():
                self.send_error_json("Unauthorized: valid ?secret= required", 401)
                return

            # API: Real-time Herdr snapshot enriched with watchdog metrics and chat titles
            if path in ("/api/status", "/snapshot.json"):
                snap = get_enriched_snapshot()
                self.send_json({
                    "status": "ok",
                    "snapshot": snap,
                    "telemetry": {
                        "active_runs": list(WATCHDOG.active_runs.values()),
                        "recent_completions": WATCHDOG.recent_completions[:5]
                    }
                })
                return

            # API: List workspace project folders
            if path == "/api/workdirs":
                dirs = HERDR.list_workdirs()
                self.send_json({"status": "ok", "workdirs": dirs, "default_root": "~/Work"})
                return

            # API: Watchdog metrics & autonomous telemetry
            if path == "/api/watchdog":
                with WATCHDOG._lock:
                    runs = list(WATCHDOG.active_runs.values())
                    done = list(WATCHDOG.recent_completions)
                self.send_json({"status": "ok", "active_runs": runs, "recent_completions": done})
                return

            # API: Read specific pane terminal output
            if path.startswith("/api/pane/") and path.endswith("/read"):
                parts = path.strip("/").split("/")
                if len(parts) >= 3:
                    pane_id = unquote(parts[2])
                    lines_str = qs.get("lines", ["100"])[0]
                    lines = int(lines_str) if lines_str.isdigit() else 100
                    info = HERDR.read_pane_info(pane_id, lines=lines)
                    self.send_json({
                        "pane_id": pane_id,
                        "output": info.get("text", ""),
                        "revision": info.get("revision", 0),
                        "truncated": info.get("truncated", False),
                    })
                    return

            # API: Live terminal SSE stream for a specific pane
            if path.startswith("/api/pane/") and path.endswith("/stream"):
                parts = path.strip("/").split("/")
                if len(parts) >= 3:
                    pane_id = unquote(parts[2])
                    lines_str = qs.get("lines", ["120"])[0]
                    lines = int(lines_str) if lines_str.isdigit() else 120
                    self.handle_pane_sse_stream(pane_id, lines=lines)
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
                try:
                    from agentr.viz import get_swarm_graph_data
                    board["swarm"] = get_swarm_graph_data("/home/ashish/Work")
                except Exception:
                    pass
                self.send_json({"status": "ok", "board": board})
                return

            # API: AgentR multi-agent swarm topology & radar
            if path in ("/api/swarm", "/api/viz"):
                try:
                    from agentr.viz import get_swarm_graph_data, render_html_widget
                    data = get_swarm_graph_data("/home/ashish/Work")
                    data["html_widget"] = render_html_widget(data)
                    self.send_json({"status": "ok", "swarm": data})
                except Exception as e:
                    self.send_error_json(str(e), 500)
                return

            # API: Inter-agent message board / comms
            if path in ("/api/messages", "/api/comms"):
                limit = int(params.get("limit", [40])[0]) if "limit" in params else 40
                topic = params.get("topic", [None])[0]
                recipient = params.get("to", [None])[0]
                msgs = AGENTR.load_messages(limit=limit, topic=topic, recipient=recipient)
                self.send_json({"status": "ok", "messages": msgs, "count": len(msgs)})
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
            if pane_id:
                pane_id = unquote(pane_id)
            text = body.get("text", "")
            submit = body.get("submit", True)
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            ok = HERDR.send_input(pane_id, text, submit=submit)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "submitted": submit})
            return

        # API: Send terminal keypresses (e.g. 'ctrl+c', 'enter', 'esc')
        if path == "/api/keys":
            pane_id = body.get("pane_id")
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            pane_id = unquote(pane_id)
            raw_key = body.get("key", "")
            raw_keys = body.get("keys", [])
            if raw_key and not raw_keys:
                raw_keys = [raw_key]

            # Normalize key names for Herdr
            normalized = []
            for k in raw_keys:
                k_lower = str(k).lower().strip()
                if k_lower in ("c", "^c", "ctrl+c", "ctrl-c", "\x03"):
                    normalized.append("ctrl+c")
                elif k_lower in ("enter", "return", "\n", "\r", "\r\n"):
                    normalized.append("enter")
                elif k_lower in ("esc", "escape", "\x1b"):
                    normalized.append("esc")
                elif k_lower in ("y", "yes"):
                    HERDR.send_input(pane_id, "y", submit=True)
                    self.send_json({"status": "ok", "pane_id": pane_id, "keys": ["y", "enter"]})
                    return
                elif k_lower in ("n", "no"):
                    HERDR.send_input(pane_id, "n", submit=True)
                    self.send_json({"status": "ok", "pane_id": pane_id, "keys": ["n", "enter"]})
                    return
                elif k_lower:
                    normalized.append(k_lower)

            ok = HERDR.send_keys(pane_id, normalized)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "keys": normalized})
            return

        # API: Quick-approve button (sends 'y' + enter)
        if path == "/api/approve":
            pane_id = body.get("pane_id")
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            pane_id = unquote(pane_id)
            ok = HERDR.send_input(pane_id, "y", submit=True)
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

        # API: Remote workspace & agent launcher
        if path == "/api/agents/launch":
            label = body.get("label", "").strip()
            cwd = body.get("cwd", "~/Work").strip()
            agent = body.get("agent", "agy").strip()
            prompt = body.get("prompt", "").strip()
            res = HERDR.launch_workspace_agent(label=label, cwd=cwd, agent_kind=agent, initial_prompt=prompt)
            self.send_json(res)
            return

        # API: Emergency kill or process restart
        if path == "/api/pane/kill" or (path.startswith("/api/pane/") and path.endswith("/kill")):
            pane_id = body.get("pane_id")
            if not pane_id and path.startswith("/api/pane/"):
                pane_id = path.strip("/").split("/")[2]
            if pane_id:
                pane_id = unquote(pane_id)
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            force = body.get("force", False)
            close = body.get("close", False)
            ok = HERDR.kill_pane(pane_id, force=force, close=close)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "killed": ok})
            return

        # API: Close a terminal pane in Herdr
        if path == "/api/pane/close" or (path.startswith("/api/pane/") and path.endswith("/close")):
            pane_id = body.get("pane_id")
            if not pane_id and path.startswith("/api/pane/"):
                pane_id = path.strip("/").split("/")[2]
            if pane_id:
                pane_id = unquote(pane_id)
            if not pane_id:
                self.send_error_json("Missing 'pane_id'")
                return
            ok = HERDR.kill_pane(pane_id, close=True)
            self.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "closed": ok})
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

        # API: Post to inter-agent message board
        if path in ("/api/messages", "/api/comms"):
            body_text = body.get("body") or body.get("text", "")
            if not body_text:
                self.send_error_json("Missing 'body' or 'text'")
                return
            sender = body.get("sender", "user")
            to_target = body.get("to", "@all")
            topic = body.get("topic", "general")
            msg_type = body.get("type", "chat")
            reply_to = body.get("reply_to")
            try:
                msg = AGENTR.post_message(
                    body=body_text,
                    sender=sender,
                    to=to_target,
                    topic=topic,
                    msg_type=msg_type,
                    reply_to=reply_to
                )
                WATCHDOG.alert_events.append({
                    "type": "agent.message",
                    "message": msg
                })
                self.send_json({"status": "ok", "message": msg})
            except Exception as e:
                self.send_error_json(str(e), 500)
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
        init_event = json.dumps({"type": "init", "time": time.time(), "snapshot": get_enriched_snapshot()})
        self.wfile.write(f"data: {init_event}\n\n".encode("utf-8"))
        self.wfile.flush()

        last_state: Dict[str, str] = {}
        counter = 0

        try:
            while True:
                time.sleep(1.5)
                counter += 1
                snap = get_enriched_snapshot()
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

                # Emit any watchdog alerts (completion / blocked)
                for alt in WATCHDOG.pop_alerts():
                    alt_ev = json.dumps(alt)
                    self.wfile.write(f"data: {alt_ev}\n\n".encode("utf-8"))
                    self.wfile.flush()

                # Send periodic heartbeat or full sync with telemetry
                if counter % 2 == 0:
                    for p in panes:
                        pid = p.get("pane_id")
                        if pid:
                            p["telemetry"] = WATCHDOG.get_telemetry(pid)
                    sync_ev = json.dumps({"type": "sync", "snapshot": snap, "time": time.time()})
                    self.wfile.write(f"data: {sync_ev}\n\n".encode("utf-8"))
                    self.wfile.flush()

        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def handle_pane_sse_stream(self, pane_id: str, lines: int = 120) -> None:
        """Stream real-time terminal output updates for a specific pane."""
        self.send_response(200)
        self._send_cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        info = HERDR.read_pane_info(pane_id, lines=lines)
        last_rev = info.get("revision", -1)
        last_text = info.get("text", "")

        init_ev = json.dumps({
            "type": "terminal_init",
            "pane_id": pane_id,
            "output": last_text,
            "revision": last_rev,
            "time": time.time(),
        })
        self.wfile.write(f"data: {init_ev}\n\n".encode("utf-8"))
        self.wfile.flush()

        counter = 0
        try:
            while True:
                time.sleep(0.5)
                counter += 1
                curr = HERDR.read_pane_info(pane_id, lines=lines)
                curr_rev = curr.get("revision", 0)
                curr_text = curr.get("text", "")
                if curr_rev != last_rev or curr_text != last_text:
                    ev = json.dumps({
                        "type": "terminal_update",
                        "pane_id": pane_id,
                        "output": curr_text,
                        "revision": curr_rev,
                        "time": time.time(),
                    })
                    self.wfile.write(f"data: {ev}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    last_rev = curr_rev
                    last_text = curr_text
                elif counter % 10 == 0:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def serve_static(self, path: str) -> None:
        qs = parse_qs(urlparse(self.path).query)
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
            secret = CONFIG.get("secret", "").strip()
            if secret and (self.check_auth() or qs.get("secret", [""])[0] == secret):
                self.send_header("Set-Cookie", f"agentdesk_secret={secret}; Path=/; Max-Age=31536000; SameSite=Lax")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(f"Failed to read file: {e}", 500)


def run_server(bind: str = "0.0.0.0", port: int = 9876) -> None:
    signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
    signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))

    WATCHDOG.start()

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
