import os
import unittest
from unittest.mock import patch, MagicMock
from agentdesk.herdr_bridge import HerdrBridge


class TestHerdrBridge(unittest.TestCase):

    def setUp(self):
        self.bridge = HerdrBridge(sock_path="/nonexistent/herdr.sock")

    def test_is_available_false(self):
        self.assertFalse(self.bridge.is_available())

    def test_snapshot_fallback_when_unavailable(self):
        snap = self.bridge.get_snapshot()
        self.assertIn("error", snap)
        self.assertEqual(snap.get("panes"), [])

    @patch("agentdesk.herdr_bridge.subprocess.run")
    def test_read_pane(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="Mock pane terminal text\n", stderr="")
        output = self.bridge.read_pane("p-1", lines=50)
        self.assertIn("Mock pane terminal text", output)

    @patch("agentdesk.herdr_bridge.subprocess.run")
    def test_send_input(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok = self.bridge.send_input("p-1", "echo hi\n")
        self.assertTrue(ok)

    @patch("agentdesk.herdr_bridge.subprocess.run")
    def test_send_keys(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok = self.bridge.send_keys("p-1", ["enter"])
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
