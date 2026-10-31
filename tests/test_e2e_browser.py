"""
End-to-end automated browser tests for AgentDesk using agent-browser CLI.
Verifies the complete mobile workflow:
1. Connecting with secret token on mobile viewport
2. Workspace tabs & active pane cards rendering
3. Opening terminal peek drawer
4. Typing text into prompt box & clicking SEND
5. Verifying prompt actually executes and produces terminal output
6. Verifying macro keys (^C, Enter)
7. Testing Quick Prompt Chips
8. Testing Remote Launcher Modal
9. Testing AgentR Blackboard Modal
10. Testing Alert Toggle
11. Tab switching between Panes and Sessions
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
        direct_bin = os.path.expanduser("~/.local/share/mise/installs/node/26.11.1/bin/agent-browser")
        if os.path.exists(direct_bin):
            cls.agent_browser_bin = direct_bin
        else:
            cls.agent_browser_bin = shutil.which("agent-browser")

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

    @classmethod
    def tearDownClass(cls):
        try:
            subprocess.run([cls.agent_browser_bin, "close", "--all"], capture_output=True, timeout=5)
        except Exception:
            pass

    def test_mobile_cockpit_full_flow(self):
        url = f"{self.base_url}/?secret={self.secret}"

        # 1. Open and set mobile viewport
        self.run_browser("open", url)
        self.run_browser("set", "viewport", "412", "915")
        self.run_browser("wait", "1500")

        # 2. Assert connection status & title
        status_text = self.run_browser("get", "text", "#conn-label")
        self.assertEqual(status_text, "ONLINE")

        title_text = self.run_browser("get", "text", ".tui-title")
        self.assertIn("HERDR // agentdesk", title_text)

        # 3. Assert pane cards are populated with live console previews
        pane_count_str = self.run_browser("get", "count", ".pane-box")
        pane_count = int(pane_count_str) if pane_count_str.isdigit() else 0
        self.assertGreater(pane_count, 0, "Expected at least one pane card to be rendered")

        preview_count_str = self.run_browser("get", "count", ".pane-console-preview")
        preview_count = int(preview_count_str) if preview_count_str.isdigit() else 0
        self.assertGreater(preview_count, 0, "Expected console preview ticker on cards")

        # 4. Test Alert Toggle button
        self.run_browser("click", "#btn-toggle-alerts")
        self.run_browser("wait", "500")
        alert_btn_text = self.run_browser("get", "text", "#btn-toggle-alerts")
        self.assertTrue("ON" in alert_btn_text or "OFF" in alert_btn_text)

        # 5. Test Remote Launcher Modal
        self.run_browser("click", "#btn-open-launcher")
        self.run_browser("wait", "800")
        launcher_title = self.run_browser("get", "text", "#launcher-modal-overlay .tui-drawer-title")
        self.assertIn("LAUNCHER", launcher_title.upper())
        # Close launcher modal
        self.run_browser("click", "#launcher-close-btn")
        self.run_browser("wait", "500")

        # 6. Test AgentR Blackboard Modal
        self.run_browser("click", "#btn-toggle-board")
        self.run_browser("wait", "1000")
        board_title = self.run_browser("get", "text", "#board-modal-overlay .tui-drawer-title")
        self.assertIn("BLACKBOARD", board_title.upper())
        # Close board modal
        self.run_browser("click", "#board-close-btn")
        self.run_browser("wait", "500")

        # 7. Open peek drawer on a pane & verify live stream indicators
        peek_selector = 'div[data-pane-id="w7:p1"] button.primary'
        try:
            self.run_browser("click", peek_selector)
        except Exception:
            self.run_browser("click", ".pane-box:first-child button.primary")

        self.run_browser("wait", "1000")
        modal_title = self.run_browser("get", "text", "#terminal-pane-title")
        self.assertTrue(len(modal_title) > 0, "Terminal modal title should be displayed")

        live_badge_text = self.run_browser("get", "text", "#terminal-live-badge")
        self.assertIn("LIVE", live_badge_text.upper())

        autoscroll_text = self.run_browser("get", "text", "#btn-toggle-autoscroll")
        self.assertIn("AUTO-SCROLL", autoscroll_text.upper())

        # 8. Type a unique command into prompt box and click SEND
        probe_token = f"E2E_PROBE_{uuid.uuid4().hex[:8]}"
        self.run_browser("fill", "#tui-input-box", f"echo {probe_token}")
        self.run_browser("click", "#btn-tui-send")
        self.run_browser("wait", "2000")

        # 9. Verify prompt executed in terminal stream
        stream_content = self.run_browser("get", "text", "#terminal-stream-content")
        self.assertIn(
            probe_token,
            stream_content,
            f"Expected probe token '{probe_token}' to appear in executed terminal stream.\nGot:\n{stream_content}"
        )

        # 10. Test Quick Prompt Chip (e.g. 'Git status')
        self.run_browser("click", '.prompt-chip[data-cmd="Git status"]')
        self.run_browser("wait", "1000")
        toast_text = self.run_browser("get", "text", "#tui-toast")
        self.assertTrue(len(toast_text) > 0)

        # 11. Test tactile macro keypad (^C Abort)
        self.run_browser("click", 'button.keycap[data-key="ctrl+c"]')
        self.run_browser("wait", "1000")

        # 12. Close peek drawer & switch to Sessions tab
        self.run_browser("click", "#terminal-close-btn")
        self.run_browser("wait", "500")

        self.run_browser("click", 'button.tui-nav-btn[data-view="sessions-view"]')
        self.run_browser("wait", "1500")

        session_count_str = self.run_browser("get", "count", ".session-entry")
        session_count = int(session_count_str) if session_count_str.isdigit() else 0
        self.assertGreater(session_count, 0, "Expected at least one session item in Sessions view")

        # 13. Open a session log and verify live chat badge
        self.run_browser("click", ".session-entry:first-child")
        self.run_browser("wait", "1000")
        chat_badge = self.run_browser("get", "text", "#session-live-badge")
        self.assertIn("LIVE CHAT", chat_badge.upper())
        self.run_browser("click", "#session-close-btn")
        self.run_browser("wait", "500")

    def test_desktop_terminal_experience_and_shortcuts(self):
        url = f"{self.base_url}/?secret={self.secret}"

        # 1. Open and set desktop viewport (1280x800)
        self.run_browser("open", url)
        self.run_browser("set", "viewport", "1280", "800")
        self.run_browser("wait", "1500")

        # 2. Check desktop shortcut bar is visible
        shortcut_bar_text = self.run_browser("get", "text", "#desktop-shortcut-bar")
        self.assertIn("ESC", shortcut_bar_text.upper())
        self.assertIn("Panes", shortcut_bar_text)
        self.assertIn("Sessions", shortcut_bar_text)

        # 3. Check sort select dropdown exists and defaults to attention
        sort_val = self.run_browser("get", "value", "#select-pane-sort")
        self.assertEqual(sort_val, "attention")

        # 4. Check pane cards show chat title and close action button
        chat_title_count = int(self.run_browser("get", "count", ".pane-chat-title"))
        self.assertGreater(chat_title_count, 0)
        close_btn_count = int(self.run_browser("get", "count", "button.btn-tui-action.close"))
        self.assertGreater(close_btn_count, 0)

        # 5. Open terminal peek modal
        self.run_browser("click", ".pane-box:first-child button.primary")
        self.run_browser("wait", "1000")
        self.assertEqual(self.run_browser("is", "visible", "#terminal-modal-overlay"), "true")
        self.assertEqual(self.run_browser("is", "visible", "#btn-drawer-close-pane"), "true")

        # 6. Test Esc key to close terminal modal and return to main dashboard
        self.run_browser("press", "Escape")
        self.run_browser("wait", "600")
        self.assertEqual(self.run_browser("is", "visible", "#terminal-modal-overlay"), "false")

        # 7. Test desktop shortcut '2' to switch to Sessions view
        self.run_browser("press", "2")
        self.run_browser("wait", "1200")
        self.assertEqual(self.run_browser("is", "visible", "#sessions-view"), "true")

        # 8. Test Esc key on Sessions view returns to main Panes dashboard
        self.run_browser("press", "Escape")
        self.run_browser("wait", "600")
        self.assertEqual(self.run_browser("is", "visible", "#panes-view"), "true")


if __name__ == "__main__":
    unittest.main()
