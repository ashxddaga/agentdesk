"""
agentdesk.events: SSE event streaming for real-time dashboard state updates
and live terminal output feeds.
"""
from __future__ import annotations

import json
import time
from typing import Dict, Any, Optional

from .herdr_bridge import HerdrBridge
from .agentr_bridge import AgentRBridge
from .watchdog import AutonomousWatchdog

SESSION_DETAILS_CACHE: Dict[str, Dict[str, Any]] = {}
SESSION_DETAILS_TIME = 0.0


def get_enriched_snapshot(
    herdr: Optional[HerdrBridge] = None,
    agentr: Optional[AgentRBridge] = None,
    watchdog: Optional[AutonomousWatchdog] = None,
) -> Dict[str, Any]:
    global SESSION_DETAILS_CACHE, SESSION_DETAILS_TIME
    if herdr is None or agentr is None or watchdog is None:
        import agentdesk.server as srv
        herdr = herdr or srv.HERDR
        agentr = agentr or srv.AGENTR
        watchdog = watchdog or srv.WATCHDOG

    snap = herdr.get_snapshot()
    panes = snap.get("panes", [])
    now = time.time()

    # Refresh session mapping cache every 4 seconds
    if now - SESSION_DETAILS_TIME > 4.0 or not SESSION_DETAILS_CACHE:
        try:
            sessions = agentr.list_sessions(limit=50)
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
        p["telemetry"] = watchdog.get_telemetry(pid)

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


def stream_dashboard_events(
    handler: Any,
    herdr: HerdrBridge,
    agentr: AgentRBridge,
    watchdog: AutonomousWatchdog,
) -> None:
    """Streams SSE events for pane state changes, watchdog alerts, and periodic sync snapshots."""
    handler.send_response(200)
    handler._send_cors()
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache, no-transform")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    init_event = json.dumps({"type": "init", "time": time.time(), "snapshot": get_enriched_snapshot(herdr, agentr, watchdog)})
    handler.wfile.write(f"data: {init_event}\n\n".encode("utf-8"))
    handler.wfile.flush()

    last_state: Dict[str, str] = {}
    counter = 0

    try:
        while True:
            time.sleep(1.5)
            counter += 1
            snap = get_enriched_snapshot(herdr, agentr, watchdog)
            panes = snap.get("panes", [])

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
                handler.wfile.write(f"data: {ev}\n\n".encode("utf-8"))
                handler.wfile.flush()

            for alt in watchdog.pop_alerts():
                alt_ev = json.dumps(alt)
                handler.wfile.write(f"data: {alt_ev}\n\n".encode("utf-8"))
                handler.wfile.flush()

            if counter % 2 == 0:
                for p in panes:
                    pid = p.get("pane_id")
                    if pid:
                        p["telemetry"] = watchdog.get_telemetry(pid)
                sync_ev = json.dumps({"type": "sync", "snapshot": snap, "time": time.time()})
                handler.wfile.write(f"data: {sync_ev}\n\n".encode("utf-8"))
                handler.wfile.flush()

    except (BrokenPipeError, ConnectionResetError, OSError):
        pass


def stream_pane_terminal(
    handler: Any,
    herdr: HerdrBridge,
    pane_id: str,
    lines: int = 120,
) -> None:
    """Streams SSE updates for live terminal output from a specific pane."""
    handler.send_response(200)
    handler._send_cors()
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache, no-transform")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    info = herdr.read_pane_info(pane_id, lines=lines)
    last_rev = info.get("revision", -1)
    last_text = info.get("text", "")

    init_ev = json.dumps({
        "type": "terminal_init",
        "pane_id": pane_id,
        "output": last_text,
        "revision": last_rev,
        "time": time.time(),
    })
    handler.wfile.write(f"data: {init_ev}\n\n".encode("utf-8"))
    handler.wfile.flush()

    counter = 0
    try:
        while True:
            time.sleep(0.5)
            counter += 1
            curr = herdr.read_pane_info(pane_id, lines=lines)
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
                handler.wfile.write(f"data: {ev}\n\n".encode("utf-8"))
                handler.wfile.flush()
                last_rev = curr_rev
                last_text = curr_text
            elif counter % 20 == 0:
                handler.wfile.write(b": ping\n\n")
                handler.wfile.flush()

    except (BrokenPipeError, ConnectionResetError, OSError):
        pass
