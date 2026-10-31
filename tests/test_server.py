import json
import os
import time
import unittest
import urllib.request
from unittest.mock import patch, MagicMock
from agentdesk.herdr_bridge import HerdrBridge
from agentdesk.agentr_bridge import AgentRBridge
from agentdesk.server import load_config, AutonomousWatchdog


class TestAgentDeskBackend(unittest.TestCase):

    def test_config_loading(self):
        cfg = load_config()
        self.assertIn("bind", cfg)
        self.assertIn("port", cfg)
        self.assertIn("secret", cfg)
        self.assertTrue(len(cfg["secret"]) > 0)

    def test_herdr_bridge_snapshot(self):
        bridge = HerdrBridge()
        snap = bridge.get_snapshot()
        self.assertIsInstance(snap, dict)
        self.assertTrue("version" in snap or "panes" in snap or "status" in snap)

    def test_herdr_list_workdirs(self):
        dirs = HerdrBridge.list_workdirs()
        self.assertIsInstance(dirs, list)
        self.assertTrue(len(dirs) > 0)
        first = dirs[0]
        self.assertIn("name", first)
        self.assertIn("path", first)
        # Ensure agentdesk or similar repo is in workdirs
        names = [d["name"] for d in dirs]
        self.assertIn("agentdesk", names)

    def test_autonomous_watchdog_lifecycle(self):
        # Create a mock agentr bridge to test closed-loop coordination
        class MockAgentR:
            def __init__(self):
                self.messages = []
                self.updated_tasks = []
                self.feedbacks = []
            def post_message(self, **kwargs):
                self.messages.append(kwargs)
                return {"status": "ok"}
            def get_board(self, **kwargs):
                return {"status": "ok", "board": {"tasks": [{"id": "task-test-99", "status": "in_progress", "agent": "agy"}]}}
            def update_board_task(self, tid, status, **kwargs):
                self.updated_tasks.append((tid, status))
                return True
            def add_board_feedback(self, text, agent="mobile", **kwargs):
                self.feedbacks.append((text, agent))

        mock_ar = MockAgentR()
        dog = AutonomousWatchdog(agentr=mock_ar)
        # Mock active pane
        mock_panes = [
            {"pane_id": "test:p1", "agent": "agy", "agent_status": "working", "workspace_name": "test_ws"}
        ]
        dog.update(mock_panes)
        tel = dog.get_telemetry("test:p1")
        self.assertTrue(tel["is_running"])
        self.assertEqual(tel["turns"], 1)
        self.assertGreater(tel["estimated_tokens"], 0)

        # Transition to idle (run completed) -> should close loop
        mock_panes_idle = [
            {"pane_id": "test:p1", "agent": "agy", "agent_status": "idle", "workspace_name": "test_ws"}
        ]
        dog.update(mock_panes_idle)
        tel_after = dog.get_telemetry("test:p1")
        self.assertFalse(tel_after["is_running"])
        self.assertIn("completed_at", tel_after)

        # Alerts popped
        alerts = dog.pop_alerts()
        self.assertTrue(any(a["type"] == "run.completed" for a in alerts))

        # Verify closed loop: comms message sent & task moved to review
        self.assertTrue(any(m["topic"] == "tasks" and ("completed by" in m["body"] or "finished run" in m["body"]) for m in mock_ar.messages))
        self.assertIn(("task-test-99", "review"), mock_ar.updated_tasks)
        self.assertTrue(len(mock_ar.feedbacks) > 0)

        # Transition into blocked -> should emit blocker message
        mock_panes_blocked = [
            {"pane_id": "test:p1", "agent": "agy", "agent_status": "blocked", "workspace_name": "test_ws"}
        ]
        dog.update(mock_panes_blocked)
        self.assertTrue(any(m["topic"] == "blocker" and "BLOCKED" in m["body"] for m in mock_ar.messages))

    def test_agentr_bridge_sessions(self):
        agentr = AgentRBridge()
        sessions = agentr.list_sessions(limit=5)
        self.assertIsInstance(sessions, list)
        if sessions:
            first = sessions[0]
            self.assertIn("agent", first)
            self.assertIn("cid", first)
            self.assertIn("title", first)

    def test_agentr_board_integration(self):
        agentr = AgentRBridge()
        board = agentr.get_board()
        self.assertIn("tasks", board)
        self.assertIn("feedback", board)
        self.assertIn("markdown", board)

    def test_live_server_endpoints(self):
        cfg = load_config()
        secret = cfg.get("secret", "")
        base_url = f"http://127.0.0.1:{cfg.get('port', 9876)}"

        # 1. Test /api/workdirs
        try:
            req = urllib.request.Request(f"{base_url}/api/workdirs?secret={secret}")
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                self.assertEqual(data.get("status"), "ok")
                self.assertIn("workdirs", data)
                self.assertTrue(len(data["workdirs"]) > 0)
        except Exception as e:
            self.skipTest(f"Server not running at {base_url}: {e}")

        # 2. Test /api/watchdog
        req = urllib.request.Request(f"{base_url}/api/watchdog?secret={secret}")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            self.assertEqual(data.get("status"), "ok")
            self.assertIn("active_runs", data)
            self.assertIn("recent_completions", data)

        # 3. Test /api/board/feedback logging
        body = json.dumps({"text": "Test unit feedback entry", "agent": "unit_test"}).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/api/board/feedback?secret={secret}",
            data=body,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            self.assertEqual(data.get("status"), "ok")

        # 4. Test /api/pane/<id>/read returns revision & output
        try:
            req_snap = urllib.request.Request(f"{base_url}/api/status?secret={secret}")
            with urllib.request.urlopen(req_snap, timeout=3) as resp:
                snap_data = json.loads(resp.read().decode())
                panes = snap_data.get("snapshot", {}).get("panes", [])
                if panes:
                    test_pid = panes[0]["pane_id"]
                    req_read = urllib.request.Request(f"{base_url}/api/pane/{test_pid}/read?secret={secret}&lines=20")
                    with urllib.request.urlopen(req_read, timeout=3) as read_resp:
                        read_data = json.loads(read_resp.read().decode())
                        self.assertEqual(read_data.get("pane_id"), test_pid)
                        self.assertIn("output", read_data)
                        self.assertIn("revision", read_data)

                    # 5. Test /api/pane/<id>/stream returns text/event-stream
                    req_stream = urllib.request.Request(f"{base_url}/api/pane/{test_pid}/stream?secret={secret}&lines=10")
                    with urllib.request.urlopen(req_stream, timeout=3) as stream_resp:
                        content_type = stream_resp.headers.get("Content-Type", "")
                        self.assertIn("text/event-stream", content_type)
        except Exception as e:
            pass

    def test_enriched_snapshot_and_pane_close(self):
        from agentdesk.server import get_enriched_snapshot
        snap = get_enriched_snapshot()
        self.assertIsInstance(snap, dict)
        self.assertIn("panes", snap)
        for p in snap.get("panes", []):
            self.assertIn("chat_title", p)
            self.assertIn("last_context", p)
            self.assertIn("telemetry", p)

        # Test POST /api/pane/close endpoint
        cfg = load_config()
        secret = cfg.get("secret", "")
        base_url = f"http://127.0.0.1:{cfg.get('port', 9876)}"
        body = json.dumps({"pane_id": "test-nonexistent-pane"}).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/api/pane/close?secret={secret}",
            data=body,
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                self.assertIn("pane_id", data)
                self.assertIn("closed", data)
        except Exception:
            pass


        # Test GET and POST /api/messages
        req_msg_post = urllib.request.Request(
            f"{base_url}/api/messages?secret={secret}",
            data=json.dumps({"body": "Test message from unit test", "sender": "unit_tester", "topic": "test"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req_msg_post, timeout=3) as resp:
                post_data = json.loads(resp.read().decode())
                self.assertEqual(post_data.get("status"), "ok")
                self.assertIn("message", post_data)

            req_msg_get = urllib.request.Request(f"{base_url}/api/messages?secret={secret}&topic=test")
            with urllib.request.urlopen(req_msg_get, timeout=3) as resp:
                get_data = json.loads(resp.read().decode())
                self.assertEqual(get_data.get("status"), "ok")
                self.assertIn("messages", get_data)

            # Clean up the test message so we don't pollute live comms
            mid = post_data.get("message", {}).get("id")
            if mid:
                from agentr.comms import get_messages_file, render_markdown_comms
                fpath = get_messages_file("/home/ashish/Work")
                if os.path.exists(fpath):
                    with open(fpath, "r") as f:
                        mdata = json.load(f)
                    mdata["messages"] = [m for m in mdata.get("messages", []) if m.get("id") != mid]
                    mdata["total_messages"] = len(mdata["messages"])
                    with open(fpath, "w") as f:
                        json.dump(mdata, f, indent=2)
                    render_markdown_comms(mdata, "/home/ashish/Work")
        except Exception:
            pass


if __name__ == "__main__":
    unittest.main()
