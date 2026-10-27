import os
import shutil
import tempfile
import unittest
from agentdesk.agentr_bridge import AgentRBridge


class TestAgentRBridge(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="agentdesk_test_")
        self.bridge = AgentRBridge(workspace_dir=self.temp_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_board_lifecycle(self):
        # 1. Add task
        tid = self.bridge.add_board_task(
            "Test build pipeline",
            description="Verify mobile daemon",
            agent="opencode",
            review_by="grok",
            project_dir=self.temp_dir
        )
        self.assertTrue(tid.startswith("task-"))

        # 2. Get board
        board = self.bridge.get_board(project_dir=self.temp_dir)
        self.assertEqual(len(board["tasks"]), 1)
        self.assertEqual(board["tasks"][0]["id"], tid)
        self.assertEqual(board["tasks"][0]["status"], "todo")
        self.assertIn("Test build pipeline", board["markdown"])

        # 3. Update task status
        ok = self.bridge.update_board_task(tid, "in_progress", project_dir=self.temp_dir)
        self.assertTrue(ok)
        board = self.bridge.get_board(project_dir=self.temp_dir)
        self.assertEqual(board["tasks"][0]["status"], "in_progress")

        # 4. Add feedback
        self.bridge.add_board_feedback("Observation from mobile", agent="mobile-cockpit", project_dir=self.temp_dir)
        board = self.bridge.get_board(project_dir=self.temp_dir)
        self.assertEqual(len(board["feedback"]), 1)
        self.assertEqual(board["feedback"][0]["text"], "Observation from mobile")

    def test_list_and_search_sessions(self):
        # List sessions with limit
        sessions = self.bridge.list_sessions(limit=3)
        self.assertIsInstance(sessions, list)
        # Search empty query
        results = self.bridge.search_sessions("test", limit=5)
        self.assertIsInstance(results, list)


if __name__ == "__main__":
    unittest.main()
