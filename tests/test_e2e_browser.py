"""
End-to-end automated browser tests for AgentDesk using agent-browser CLI.
Verifies the complete mobile workflow:
1. Connecting with secret token on mobile viewport
2. Workspace tabs & active pane cards rendering
3. Opening terminal peek drawer
4. Typing text into prompt box & clicking SEND
5. Verifying prompt actually executes and produces terminal output
6. Verifying macro keys (^C, Enter)
7. Tab switching between Panes and Sessions
"""
import json
import os
import shutil
import subprocess
import time
import unittest
import uuid
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.config/agentdesk/config.json")
DEFAULT_SECRET = "63df263a-e1e4-4854-998c-7b1e8ce33dd4"


def get_secret() -> str:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                return json.load(f).get("secret", DEFAULT_SECRET)
        except Exception:
            pass
    return DEFAULT_SECRET


class TestAgentDeskBrowserE2E(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Locate agent-browser
        cls.agent_browser_bin = shutil.which("agent-browser")
        if not cls.agent_browser_bin:
            fallback = os.path.expanduser("~/.local/share/mise/installs/node/26.11.1/bin/agent-browser")
            if os.path.exists(fallback):
                cls.agent_browser_bin = fallback

        if not cls.agent_browser_bin:
            raise unittest.SkipTest("agent-browser CLI not found on this machine")

        cls.secret = get_secret()
        cls.base_url = "http://127.0.0.1:9876"

        # Check if server is running
        try:
            req = urllib.request.Request(f"{cls.base_url}/api/status?secret={cls.secret}")
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                if data.get("status") != "ok":
                    raise RuntimeError("Server returned unexpected status")
        except Exception as e:
            raise unittest.SkipTest(f"AgentDesk server not reachable at {cls.base_url}: {e}")

    def run_browser(self, *args, timeout=15) -> str:
        cmd = [self.agent_browser_bin] + list(args)
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            raise RuntimeError(f"agent-browser failed ({res.returncode}): {res.stderr}\n{res.stdout}")
        return res.stdout.strip()

    def tearDown(self):
        try:
            subprocess.run([self.agent_browser_bin, "close", "--all"], capture_output=True, timeout=5)
        except Exception:
            pass

    def test_mobile_cockpit_full_flow(self):
        url = f"{self.base_url}/?secret={self.secret}"

        # 1. Set mobile viewport and navigate
        self.run_browser("set", "viewport", "412", "915")
        self.run_browser("open", url)
        self.run_browser("wait", "1500")

        # 2. Assert connection status & title
        status_text = self.run_browser("get", "text", "#conn-label")
        self.assertEqual(status_text, "ONLINE")

        title_text = self.run_browser("get", "text", ".tui-title")
        self.assertIn("HERDR // agentdesk", title_text)

        # 3. Assert pane cards are populated
        pane_count_str = self.run_browser("get", "count", ".pane-box")
        pane_count = int(pane_count_str) if pane_count_str.isdigit() else 0
        self.assertGreater(pane_count, 0, "Expected at least one pane card to be rendered")

        # 4. Open peek drawer on a pane (use w7:p1 or the first available pane)
        peek_selector = 'div[data-pane-id="w7:p1"] button.primary'
        try:
            self.run_browser("click", peek_selector)
        except Exception:
            # Fallback to the first pane's peek button
            self.run_browser("click", ".pane-box:first-child button.primary")

        self.run_browser("wait", "1000")
        modal_title = self.run_browser("get", "text", "#terminal-pane-title")
        self.assertTrue(len(modal_title) > 0, "Terminal modal title should be displayed")

        # 5. Type a unique command into prompt box and click SEND
        probe_token = f"E2E_PROBE_{uuid.uuid4().hex[:8]}"
        self.run_browser("fill", "#tui-input-box", f"echo {probe_token}")
        self.run_browser("click", "#btn-tui-send")
        self.run_browser("wait", "2000")

        # 6. Verify that prompt actually executed in the terminal stream!
        stream_content = self.run_browser("get", "text", "#terminal-stream-content")
        self.assertIn(
            probe_token,
            stream_content,
            f"Expected probe token '{probe_token}' to appear in executed terminal stream.\nGot:\n{stream_content}"
        )

        # 7. Test tactile macro keypad (^C Abort)
        self.run_browser("click", 'button.keycap[data-key="ctrl+c"]')
        self.run_browser("wait", "1000")
        toast_text = self.run_browser("get", "text", "#tui-toast")
        self.assertIn("CTRL+C", toast_text.upper())

        # 8. Close peek drawer & switch to Sessions tab
        self.run_browser("click", "#terminal-close-btn")
        self.run_browser("wait", "500")

        self.run_browser("click", 'button.tui-nav-btn[data-view="sessions-view"]')
        self.run_browser("wait", "1500")

        session_count_str = self.run_browser("get", "count", ".session-entry")
        session_count = int(session_count_str) if session_count_str.isdigit() else 0
        self.assertGreater(session_count, 0, "Expected at least one session item in Sessions view")


if __name__ == "__main__":
    unittest.main()
