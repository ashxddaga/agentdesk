"""
agentdesk.agentr_bridge: Interface to the AgentR engine for session search,
                          transcript retrieval, handoffs, and project blackboard.
"""
from __future__ import annotations

import os
from typing import Optional, List, Dict, Any

from agentr.core import SessionInfo, build_handoff_briefing
from agentr.adapters import get_adapter, get_active_adapters
from agentr.board import (
    load_board,
    add_task,
    update_task_status,
    add_feedback,
    render_markdown_board,
)


class AgentRBridge:
    def __init__(self, workspace_dir: str = "/home/ashish/Work"):
        self.workspace_dir = workspace_dir

    def list_sessions(self, filter_agent: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """List unified recent sessions across all active agents."""
        adapters = [get_adapter(filter_agent)] if filter_agent and get_adapter(filter_agent) else get_active_adapters()
        all_sessions: List[SessionInfo] = []
        for a in adapters:
            if a:
                try:
                    all_sessions.extend(a.list_sessions())
                except Exception:
                    pass

        all_sessions.sort(key=lambda s: s.timestamp, reverse=True)
        results = []
        for s in all_sessions[:limit]:
            results.append({
                "agent": s.agent,
                "cid": s.cid,
                "dt_str": s.dt_str,
                "title": s.title,
                "step_count": s.step_count,
                "snippet": s.snippet,
                "workdir": s.workdir,
                "timestamp": s.timestamp,
                "key": s.key,
            })
        return results

    def get_session_details(self, agent: str, cid: str) -> Dict[str, Any]:
        """Fetch title, workdir, turn messages, and summary briefing for a session."""
        adapter = get_adapter(agent)
        if not adapter:
            raise ValueError(f"Unknown agent '{agent}'")

        if hasattr(adapter, "extract_briefing_context"):
            title, workdir, user_prompts, assistant_msgs = adapter.extract_briefing_context(cid, "")
        elif hasattr(adapter, "get_session_details"):
            title, workdir, user_prompts, assistant_msgs = adapter.get_session_details(cid)
        else:
            title, workdir, user_prompts, assistant_msgs = cid, "", [], []

        try:
            briefing, _, _ = build_handoff_briefing(agent, cid, workdir, title, user_prompts, assistant_msgs)
        except Exception:
            briefing = f"# Session {cid}\n**Title**: {title}\n**Agent**: {agent}"

        return {
            "agent": agent,
            "cid": cid,
            "title": title,
            "workdir": workdir,
            "turn_count": len(user_prompts),
            "user_prompts": user_prompts,
            "assistant_msgs": assistant_msgs,
            "briefing": briefing,
        }

    def search_sessions(self, query: str, filter_agent: Optional[str] = None, limit: int = 30) -> List[Dict[str, Any]]:
        """Search across transcripts of all agents."""
        adapters = [get_adapter(filter_agent)] if filter_agent and get_adapter(filter_agent) else get_active_adapters()
        results = []
        for a in adapters:
            if a:
                try:
                    found = a.search(query)
                    for r in found:
                        results.append({
                            "agent": r.agent,
                            "cid": r.cid,
                            "dt_str": r.dt_str,
                            "title": r.title,
                            "step_count": r.step_count,
                            "snippet": r.snippet,
                            "workdir": r.workdir,
                            "timestamp": r.timestamp,
                            "key": r.key,
                        })
                except Exception:
                    pass

        results.sort(key=lambda x: x["timestamp"], reverse=True)
        return results[:limit]

    def execute_handoff(self, agent: str, cid: str, target_agent: str) -> Dict[str, Any]:
        """Prepare briefing and transfer session context to target agent."""
        adapter = get_adapter(agent)
        target_adapter = get_adapter(target_agent)
        if not adapter or not target_adapter:
            raise ValueError(f"Invalid agent transfer: '{agent}' -> '{target_agent}'")

        if hasattr(adapter, "extract_briefing_context"):
            title, workdir, user_prompts, assistant_msgs = adapter.extract_briefing_context(cid, "")
        elif hasattr(adapter, "get_session_details"):
            title, workdir, user_prompts, assistant_msgs = adapter.get_session_details(cid)
        else:
            title, workdir, user_prompts, assistant_msgs = cid, "", [], []

        briefing, _, _ = build_handoff_briefing(agent, cid, workdir, title, user_prompts, assistant_msgs)

        target_adapter.receive_handoff(briefing, title, workdir or self.workspace_dir)
        return {"status": "ok", "target": target_adapter.display_name, "title": title}

    def get_board(self, project_dir: Optional[str] = None) -> Dict[str, Any]:
        """Fetch active coordination board data (tasks and feedback)."""
        base = project_dir or self.workspace_dir
        board = load_board(base)
        board["markdown"] = render_markdown_board(board, base)
        return board

    def add_board_task(self, title: str, description: str = "", agent: str = "agy", review_by: str = "grok", project_dir: Optional[str] = None) -> str:
        base = project_dir or self.workspace_dir
        return add_task(title, description=description, agent=agent, review_by=review_by, project_dir=base)

    def update_board_task(self, task_id: str, status: str, project_dir: Optional[str] = None) -> bool:
        base = project_dir or self.workspace_dir
        return update_task_status(task_id, status, project_dir=base)

    def add_board_feedback(self, text: str, agent: str = "mobile", project_dir: Optional[str] = None) -> None:
        base = project_dir or self.workspace_dir
        add_feedback(text, agent=agent, project_dir=base)
