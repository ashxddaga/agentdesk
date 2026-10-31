"""
agentdesk.api_routes: REST API route handlers for Herdr multiplexing,
AgentR blackboard, sessions, and inter-agent communication.
"""
from __future__ import annotations

import json
from urllib.parse import unquote
from typing import Dict, Any, List

from .herdr_bridge import HerdrBridge
from .agentr_bridge import AgentRBridge
from .watchdog import AutonomousWatchdog
from .events import stream_dashboard_events, stream_pane_terminal


def handle_api_get(
    handler: Any,
    path: str,
    qs: Dict[str, List[str]],
    herdr: HerdrBridge,
    agentr: AgentRBridge,
    watchdog: AutonomousWatchdog,
) -> bool:
    """Dispatches GET requests. Returns True if handled, False if unhandled (fall through to static)."""

    # API: System status and Herdr snapshot
    if path == "/api/status" or path == "/api/snapshot":
        from .events import get_enriched_snapshot
        snap = get_enriched_snapshot(herdr, agentr, watchdog)
        handler.send_json({"status": "ok", "snapshot": snap})
        return True

    # API: Quick health check
    if path == "/api/health":
        handler.send_json({"status": "ok", "herdr_connected": herdr.is_available()})
        return True

    # API: Active workspaces discovery
    if path == "/api/workdirs":
        workdirs = herdr.list_active_workdirs()
        handler.send_json({"status": "ok", "workdirs": workdirs})
        return True

    # API: Read specific pane terminal output
    if path.startswith("/api/pane/") and (path.endswith("/terminal") or path.endswith("/read")):
        pane_id = path.strip("/").split("/")[2]
        pane_id = unquote(pane_id)
        lines_str = qs.get("lines", ["120"])[0]
        lines = int(lines_str) if lines_str.isdigit() else 120
        res = herdr.read_pane_info(pane_id, lines=lines)
        handler.send_json(res)
        return True

    # API: Live SSE stream of terminal output
    if path.startswith("/api/pane/") and path.endswith("/stream"):
        pane_id = path.strip("/").split("/")[2]
        pane_id = unquote(pane_id)
        lines_str = qs.get("lines", ["120"])[0]
        lines = int(lines_str) if lines_str.isdigit() else 120
        stream_pane_terminal(handler, herdr, pane_id, lines=lines)
        return True

    # API: Unified recent sessions via AgentR
    if path == "/api/sessions":
        agent_filter = qs.get("agent", [None])[0]
        limit_str = qs.get("limit", ["50"])[0]
        limit = int(limit_str) if limit_str.isdigit() else 50
        sessions = agentr.list_sessions(filter_agent=agent_filter, limit=limit)
        handler.send_json({"status": "ok", "sessions": sessions})
        return True

    # API: Session transcript details via AgentR
    if path == "/api/sessions/details":
        agent = qs.get("agent", [""])[0]
        cid = qs.get("cid", [""])[0]
        if not agent or not cid:
            handler.send_error_json("Missing 'agent' or 'cid' param")
            return True
        try:
            details = agentr.get_session_details(agent, cid)
            handler.send_json({"status": "ok", "details": details})
        except Exception as e:
            handler.send_error_json(str(e), 404)
        return True

    # API: Deep search across all agent sessions
    if path == "/api/search":
        q = qs.get("q", [""])[0]
        agent_filter = qs.get("agent", [None])[0]
        if not q:
            handler.send_json({"status": "ok", "results": []})
            return True
        results = agentr.search_sessions(q, filter_agent=agent_filter)
        handler.send_json({"status": "ok", "query": q, "results": results})
        return True

    # API: AgentR coordination board
    if path == "/api/board":
        board = agentr.get_board()
        try:
            from agentr.viz import get_swarm_graph_data
            board["swarm"] = get_swarm_graph_data("/home/ashish/Work")
        except Exception:
            pass
        handler.send_json({"status": "ok", "board": board})
        return True

    # API: AgentR multi-agent swarm topology & radar
    if path in ("/api/swarm", "/api/viz"):
        try:
            from agentr.viz import get_swarm_graph_data, render_html_widget
            data = get_swarm_graph_data("/home/ashish/Work")
            data["html_widget"] = render_html_widget(data)
            handler.send_json({"status": "ok", "swarm": data})
        except Exception as e:
            handler.send_error_json(str(e), 500)
        return True

    # API: Inter-agent message board / comms
    if path in ("/api/messages", "/api/comms"):
        limit = int(qs.get("limit", ["40"])[0]) if "limit" in qs else 40
        topic = qs.get("topic", [None])[0]
        recipient = qs.get("to", [None])[0]
        msgs = agentr.load_messages(limit=limit, topic=topic, recipient=recipient)
        handler.send_json({"status": "ok", "messages": msgs, "count": len(msgs)})
        return True

    # API: Real-time Server-Sent Events (SSE)
    if path in ("/api/events", "/events"):
        stream_dashboard_events(handler, herdr, agentr, watchdog)
        return True

    return False


def handle_api_post(
    handler: Any,
    path: str,
    body: Dict[str, Any],
    herdr: HerdrBridge,
    agentr: AgentRBridge,
    watchdog: AutonomousWatchdog,
) -> bool:
    """Dispatches POST requests. Returns True if handled, False if route not recognized."""

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
            handler.send_error_json("Missing 'pane_id'")
            return True
        ok = herdr.send_input(pane_id, text, submit=submit)
        handler.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "submitted": submit})
        return True

    # API: Send terminal keypresses (e.g. 'up', 'down', 'alt+m', 'ctrl+c', 'enter', 'esc')
    if path == "/api/keys":
        pane_id = body.get("pane_id")
        if not pane_id:
            handler.send_error_json("Missing 'pane_id'")
            return True
        pane_id = unquote(pane_id)
        raw_key = body.get("key", "")
        raw_keys = body.get("keys", [])
        if raw_key and not raw_keys:
            raw_keys = [raw_key]

        normalized = []
        for k in raw_keys:
            k_lower = str(k).lower().strip()
            if k_lower in ("up", "arrowup", "\x1b[a"):
                normalized.append("up")
            elif k_lower in ("down", "arrowdown", "\x1b[b"):
                normalized.append("down")
            elif k_lower in ("left", "arrowleft", "\x1b[d"):
                normalized.append("left")
            elif k_lower in ("right", "arrowright", "\x1b[c"):
                normalized.append("right")
            elif k_lower in ("tab", "\t"):
                normalized.append("tab")
            elif k_lower in ("space", " "):
                normalized.append("space")
            elif k_lower in ("alt+m", "alt-m", "m+alt", "\x1bm", "meta+m"):
                normalized.append("alt+m")
            elif k_lower in ("c", "^c", "ctrl+c", "ctrl-c", "\x03"):
                normalized.append("ctrl+c")
            elif k_lower in ("d", "^d", "ctrl+d", "ctrl-d", "\x04"):
                normalized.append("ctrl+d")
            elif k_lower in ("enter", "return", "\n", "\r", "\r\n"):
                normalized.append("enter")
            elif k_lower in ("esc", "escape", "\x1b"):
                normalized.append("esc")
            elif k_lower in ("y", "yes"):
                herdr.send_input(pane_id, "y", submit=True)
                handler.send_json({"status": "ok", "pane_id": pane_id, "keys": ["y", "enter"]})
                return True
            elif k_lower in ("n", "no"):
                herdr.send_input(pane_id, "n", submit=True)
                handler.send_json({"status": "ok", "pane_id": pane_id, "keys": ["n", "enter"]})
                return True
            elif k_lower:
                normalized.append(k_lower)

        ok = herdr.send_keys(pane_id, normalized)
        handler.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "keys": normalized})
        return True

    # API: Quick-approve button (sends 'y' + enter)
    if path == "/api/approve":
        pane_id = body.get("pane_id")
        if not pane_id:
            handler.send_error_json("Missing 'pane_id'")
            return True
        pane_id = unquote(pane_id)
        ok = herdr.send_input(pane_id, "y", submit=True)
        handler.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "approved": True})
        return True

    # API: Cross-agent handoff trigger
    if path == "/api/handoff":
        agent = body.get("agent", "")
        cid = body.get("cid", "")
        target = body.get("target", "")
        if not agent or not cid or not target:
            handler.send_error_json("Missing 'agent', 'cid', or 'target'")
            return True
        try:
            res = agentr.execute_handoff(agent, cid, target)
            handler.send_json(res)
        except Exception as e:
            handler.send_error_json(str(e), 500)
        return True

    # API: Remote workspace & agent launcher
    if path == "/api/agents/launch":
        label = body.get("label", "").strip()
        cwd = body.get("cwd", "~/Work").strip()
        agent = body.get("agent", "agy").strip()
        prompt = body.get("prompt", "").strip()
        res = herdr.launch_workspace_agent(label=label, cwd=cwd, agent_kind=agent, initial_prompt=prompt)
        handler.send_json(res)
        return True

    # API: Emergency kill or process restart
    if path == "/api/pane/kill" or (path.startswith("/api/pane/") and path.endswith("/kill")):
        pane_id = body.get("pane_id")
        if not pane_id and path.startswith("/api/pane/"):
            pane_id = path.strip("/").split("/")[2]
        if pane_id:
            pane_id = unquote(pane_id)
        if not pane_id:
            handler.send_error_json("Missing 'pane_id'")
            return True
        force = body.get("force", False)
        close = body.get("close", False)
        ok = herdr.kill_pane(pane_id, force=force, close=close)
        handler.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "killed": ok})
        return True

    # API: Close a terminal pane in Herdr
    if path == "/api/pane/close" or (path.startswith("/api/pane/") and path.endswith("/close")):
        pane_id = body.get("pane_id")
        if not pane_id and path.startswith("/api/pane/"):
            pane_id = path.strip("/").split("/")[2]
        if pane_id:
            pane_id = unquote(pane_id)
        if not pane_id:
            handler.send_error_json("Missing 'pane_id'")
            return True
        ok = herdr.kill_pane(pane_id, close=True)
        handler.send_json({"status": "ok" if ok else "failed", "pane_id": pane_id, "closed": ok})
        return True

    # API: AgentR board task update
    if path == "/api/board/task/update":
        tid = body.get("id", "")
        status = body.get("status", "")
        if not tid or not status:
            handler.send_error_json("Missing 'id' or 'status'")
            return True
        ok = agentr.update_board_task(tid, status)
        handler.send_json({"status": "ok" if ok else "not_found", "id": tid})
        return True

    # API: AgentR board task add
    if path == "/api/board/task/add":
        title = body.get("title", "")
        desc = body.get("description", "")
        agent = body.get("agent", "agy")
        review_by = body.get("review_by", "grok")
        if not title:
            handler.send_error_json("Missing task 'title'")
            return True
        tid = agentr.add_board_task(title, description=desc, agent=agent, review_by=review_by)
        handler.send_json({"status": "ok", "id": tid})
        return True

    # API: AgentR board feedback add
    if path == "/api/board/feedback":
        text = body.get("text", "")
        agent = body.get("agent", "mobile")
        if not text:
            handler.send_error_json("Missing feedback 'text'")
            return True
        agentr.add_board_feedback(text, agent=agent)
        handler.send_json({"status": "ok"})
        return True

    # API: Post to inter-agent message board
    if path in ("/api/messages", "/api/comms"):
        body_text = body.get("body") or body.get("text", "")
        if not body_text:
            handler.send_error_json("Missing 'body' or 'text'")
            return True
        sender = body.get("sender", "user")
        to_target = body.get("to", "@all")
        topic = body.get("topic", "general")
        msg_type = body.get("type", "chat")
        reply_to = body.get("reply_to")
        try:
            msg = agentr.post_message(
                body=body_text,
                sender=sender,
                to=to_target,
                topic=topic,
                msg_type=msg_type,
                reply_to=reply_to
            )
            watchdog.alert_events.append({
                "type": "agent.message",
                "message": msg
            })
            handler.send_json({"status": "ok", "message": msg})
        except Exception as e:
            handler.send_error_json(str(e), 500)
        return True

    return False
