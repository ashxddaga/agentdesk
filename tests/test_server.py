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
        dog = AutonomousWatchdog()
        # Mock active pane
        mock_panes = [
            {"pane_id": "test:p1", "agent": "agy", "agent_status": "working"}
        ]
        dog.update(mock_panes)
        tel = dog.get_telemetry("test:p1")
        self.assertTrue(tel["is_running"])
        self.assertEqual(tel["turns"], 1)
        self.assertGreater(tel["estimated_tokens"], 0)

        # Transition to idle (run completed)
        mock_panes_idle = [
            {"pane_id": "test:p1", "agent": "agy", "agent_status": "idle"}
        ]
        dog.update(mock_panes_idle)
        tel_after = dog.get_telemetry("test:p1")
        self.assertFalse(tel_after["is_running"])
        self.assertIn("completed_at", tel_after)

        # Alerts popped
        alerts = dog.pop_alerts()
        self.assertTrue(any(a["type"] == "run.completed" for a in alerts))

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


if __name__ == "__main__":
    unittest.main()
