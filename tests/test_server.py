import json
import unittest
from agentdesk.herdr_bridge import HerdrBridge
from agentdesk.agentr_bridge import AgentRBridge
from agentdesk.server import load_config


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
        # Should have version, workspaces, or panes
        self.assertTrue("version" in snap or "panes" in snap or "status" in snap)

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


if __name__ == "__main__":
    unittest.main()
