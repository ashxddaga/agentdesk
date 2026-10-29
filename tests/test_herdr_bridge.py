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
        ok = self.bridge.send_input("p-1", "echo hi\n", submit=True)
        self.assertTrue(ok)
        # Should have called send-text and send-keys enter
        calls = [c[0][0] for c in mock_run.call_args_list]
        self.assertTrue(any("send-text" in cmd for cmd in calls))
        self.assertTrue(any("send-keys" in cmd for cmd in calls))

    @patch("agentdesk.herdr_bridge.subprocess.run")
    def test_send_keys(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok = self.bridge.send_keys("p-1", ["enter"])
        self.assertTrue(ok)

    def test_send_input_socket_direct(self):
        with patch.object(self.bridge, "is_available", return_value=True):
            with patch.object(self.bridge, "_call", return_value={"type": "ok"}) as mock_call:
                ok = self.bridge.send_input("p-1", "hello world", submit=True)
                self.assertTrue(ok)
                self.assertEqual(mock_call.call_count, 2)
                mock_call.assert_any_call("pane.send_text", {"pane_id": "p-1", "text": "hello world"})
                mock_call.assert_any_call("pane.send_keys", {"pane_id": "p-1", "keys": ["enter"]})


if __name__ == "__main__":
    unittest.main()
