"""
agentdesk.watchdog: Autonomous watchdog monitoring Herdr agent panes,
tracking execution duration/tokens, triggering reviews, and autonomous dispatch.
"""
from __future__ import annotations

import threading
import time
from typing import Optional, List, Dict, Any

from .herdr_bridge import HerdrBridge
from .agentr_bridge import AgentRBridge


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

                        if self.agentr:
                            try:
                                bdata = self.agentr.get_board()
                                found_task = None
                                for t in bdata.get("board", {}).get("tasks", []):
                                    if t.get("status") == "in_progress" and t.get("agent") == agent:
                                        self.agentr.update_board_task(t.get("id"), "review")
                                        self.agentr.add_board_feedback(
                                            f"Task {t.get('id')} finished by {agent} ({dur_str}). Moved to review.",
                                            agent=agent
                                        )
                                        found_task = t
                                        break
                                if found_task:
                                    self.agentr.post_message(
                                        body=f"Task {found_task.get('id')} ({found_task.get('title')}) completed by @{agent} in pane {pid} ({dur_str}). Moved to review.",
                                        sender=agent,
                                        to="@all",
                                        topic="tasks",
                                        msg_type="chat"
                                    )
                            except Exception:
                                pass

                # Transition into blocked (needs approval)
                if status == "blocked" and prev_status != "blocked":
                    self.alert_events.append({
                        "type": "agent.blocked",
                        "pane_id": pid,
                        "agent": agent,
                        "workspace": ws,
                        "text": f"⚠️ {agent.upper()} in {ws} needs tool approval!",
                    })

                    if self.agentr:
                        try:
                            self.agentr.post_message(
                                body=f"⚠️ Agent {agent} in pane {pid} ({ws}) is BLOCKED and waiting for approval or input.",
                                sender=agent,
                                to="@all",
                                topic="blocker",
                                msg_type="blocker"
                            )
                        except Exception:
                            pass

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
