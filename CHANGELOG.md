# AgentDesk — Engineering Changelog & Issue Log

All notable changes, user feedback, root cause analyses (RCA), and bug fixes are documented in this file following professional software development practices.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.0] — 2026-10-29

### 🚀 Full Delivery: Phases 3, 4 & 5 (Remote Alerts, Lifecycle Control & Autonomous Supervision)
- **Phase 3: Remote Alerts & Mobile Ergonomics**:
  - **Lock-Screen Push Notifications**: Service Worker push notification handler in `web/sw.js` with notification click autofocus and vibration pattern `[200, 100, 200]`.
  - **Synthesized Web Audio Chimes**: Dual-frequency triangle-wave chime (440Hz -> 880Hz) via HTML5 Web Audio API for background alerts without relying on external mp3 assets.
  - **Tactile Sound & Alert Toggle**: Header control `[ 🔔 ON ]` / `[ 🔕 OFF ]` storing user preference in `localStorage` and requesting browser notification permissions.
  - **One-Tap Quick Prompt Chips**: Horizontal scroll row featuring one-tap macro chips: `[ Continue ]`, `[ Run tests ]`, `[ Fix & retry ]`, `[ Git status ]`, `[ Explain ]`.
  - **Voice-to-Text Dictation**: Integrated `webkitSpeechRecognition` with active recording animation and direct insertion into terminal prompt input.
- **Phase 4: Remote Agent Lifecycle Control**:
  - **Remote Agent & Workspace Launcher (`POST /api/agents/launch`)**:
    - Select workspace directory from active repositories under `~/Work` via `GET /api/workdirs`.
    - Select agent flavor (`agy`, `opencode`, `freebuff`, `grok`, `bash`).
    - Specify custom workspace label and optional initial goal/prompt.
    - Launches a dedicated Herdr workspace and root pane over socket RPC.
  - **Emergency Process Termination (`POST /api/pane/{id}/kill`)**:
    - Dispatches clean `ctrl+c` (SIGINT) or force termination (`SIGKILL`) directly to the foreground process detected in Herdr pane info (`get_pane_process_info`).
    - Emergency termination trigger in peek drawer header (`[ 🛑 KILL ]`).
- **Phase 5: Autonomous Long Run Supervision & AgentR Integration**:
  - **Background `AutonomousWatchdog`**:
    - Threaded daemon watchdog continuously monitoring active agent states, turns count, and token expenditure estimates.
    - Emits real-time SSE lifecycle events: `run.completed` and `agent.blocked`.
  - **Live Pane Telemetry Badges**:
    - Each pane card displays real-time execution duration (`⏱️ 4m 12s`), turns executed, and estimated token usage (`~18k tok`).
  - **AgentR Task Blackboard Overlay (`GET /api/board`, `POST /api/board/feedback`)**:
    - Dedicated modal drawer accessible from header `[ 📋 BOARD ]` displaying live multi-agent task status (`todo`, `in_progress`, `review`, `done`) and frictionless feedback loop notes.
  - **Android Parity**:
    - Updated `Models.kt` and `AgentDeskClient.kt` with `launchAgent`, `killPane`, `getWorkdirs`, and telemetry data structures.
    - Repackaged `AgentDesk-Android.zip` and mirrored into `web/` for direct download.
- **Verification**:
  - Expanded unit test suite from 13 to 19 tests in `tests/test_server.py`, `tests/test_herdr_bridge.py`, and `tests/test_agentr_bridge.py`.
  - Automated headless mobile browser E2E test in `tests/test_e2e_browser.py` verifying full cockpit flow, prompt chips, launcher modal, board modal, and alert toggles.
  - 100% test pass rate across `agentdesk` (19/19) and `agentr` (17/17).

---

## [0.2.0] — 2026-10-29

### 🚀 Zero-Config Onboarding & Management CLI
- **Added**:
  - `bin/agentdesk`: Interactive CLI management tool (`agentdesk qr`, `agentdesk status`, `agentdesk restart`, `agentdesk logs`, `agentdesk test`).
  - Terminal ANSI UTF-8 QR Code generation using `qrencode` for camera scanning.
  - Dynamic Tailscale IP discovery via `tailscale ip -4` to eliminate hardcoded host configurations.
  - [`docs/GUIDE_PHONE_SETUP.md`](docs/GUIDE_PHONE_SETUP.md): Beginner-friendly 60-second connection guide.
  - [`docs/ROADMAP.md`](docs/ROADMAP.md): Detailed 5-phase product and engineering roadmap.
- **Enhanced**:
  - `install.sh`: Automatically links `~/.local/bin/agentdesk` and displays QR code on setup.
  - `README.md`: Overhauled with quickstart, CLI reference, and architecture diagram.

---

## [0.1.2] — 2026-10-29

### 🐛 Issue: Prompts Not Submitting to Terminal (Text Stuck in Message Box)
- **Reported By**: User
- **Symptom**: User sent text from the mobile input box, but it only sat in the agent's prompt line inside the terminal without executing.
- **Root Cause Analysis (RCA)**:
  `agentdesk` was calling `herdr pane send-text <PANE> <TEXT + "\n">`. In Herdr, `send-text` inserts literal string characters into the PTY stream. In full-screen and raw-mode interactive TUIs (such as `agy`, `opencode`, or shells with line editors), a literal newline byte (`0x0A`) without a terminal carriage return (`0x0D`) or discrete `Enter` keycode event does not trigger prompt submission. The text was buffered on the input line, awaiting a physical or simulated `Enter` keypress.
- **Fix & Implementation**:
  1. Updated `HerdrBridge.send_input` in `agentdesk/herdr_bridge.py` to first send text via `pane.send_text`, followed immediately by an `Enter` keypress event via `pane.send_keys ['enter']` directly over Herdr's Unix domain socket RPC.
  2. Implemented CLI fallback (`herdr pane send-text` + `herdr pane send-keys enter`) if the socket RPC is ever temporarily unavailable.
  3. Added `/api/keys` endpoint in `agentdesk/server.py` to process discrete terminal keypresses (`enter`, `ctrl+c`, `esc`).
  4. Updated web frontend `web/app.js` and `web/index.html` keypad buttons (`[ y + ↵ ]`, `[ ↵ Enter ]`, `[ ^C Abort ]`, `[ Esc ]`) to dispatch real keycodes rather than literal escape sequences.
  5. Added automatic dual-delay terminal re-fetching (at 300ms and 900ms) after prompt submission so users see their prompt and response immediately.
- **Verification**:
  - Unit test `test_send_input_socket_direct` added to `tests/test_herdr_bridge.py`.
  - Automated browser E2E test `tests/test_e2e_browser.py` using `agent-browser` verifies typing a probe command, clicking SEND, and reading the executed output directly from the terminal buffer.

### 🧪 Quality Assurance: Automated Browser E2E Test Pipeline
- **Change**: Added end-to-end browser automation into the permanent testing suite.
- **Implementation**:
  - Created `tests/test_e2e_browser.py` using `agent-browser`. It loads the mobile viewport (`412 × 915`), authenticates via token, inspects workspace tabs, executes a terminal command, tests macro keys, switches navigation tabs, and closes cleanly.
  - Created `./run_tests.sh` runner script executing both backend unit tests and browser E2E tests in a single command.
  - Documented testing contract in `AGENTS.md`.

---

## [0.1.1] — 2026-10-27

### 🎨 User Feedback: UI Overhaul to Authentic Herdr Terminal / TUI Aesthetic
- **Reported By**: User
- **Feedback**: Generic modern mobile cards felt basic and out of place. User requested the authentic Herdr terminal multiplexer vibe: dense console, monospace, TUI frames.
- **Fix & Implementation**:
  1. Rebuilt `web/style.css` and `web/index.html` using Herdr phosphor color scheme (`#07090e` console background, `#0d121c` panels, `#1e2638` borders, phosphor green `#22c55e`, cyan `#38bdf8`).
  2. Built horizontal workspace tab strip (`[ ALL 9 ] [ 1: ~General 3 ] [ 2: ~AgentR 1 ]...`) with live pane filtering.
  3. Added tactile macro keypad for terminal peek drawer (`[ y + ↵ ]`, `[ ↵ Enter ]`, `[ n ]`, `[ ^C Abort ]`, `[ Esc ]`, `[ ⬇ End ]`).
  4. Updated Jetpack Compose Android client (`MainActivity.kt` and `Theme.kt`) with monospace terminal frames and tactile macro buttons.
- **Verification**:
  - Full screenshot inspection and interaction testing via `agent-browser`.

### 🧭 Navigation Simplification: Streamlined to Panes & Sessions
- **Feedback**: Postpone the multi-agent task board until long autonomous runs are thoroughly tested. Keep the interface lean and focused.
- **Fix & Implementation**:
  - Removed `Board` tab from navigation in both web PWA and Android client.
  - Focused app on `[ ⚡ 1:PANES ]` and `[ 🔍 2:SESSIONS ]`.

---

## [0.1.0] — 2026-10-27

### 🚀 Initial Release: Core Daemon & Mobile Bridge
- **Features**:
  - Zero-dependency Python HTTP & SSE daemon (`agentdesk/server.py`).
  - Herdr Unix domain socket client (`~/.config/herdr/herdr.sock`).
  - AgentR integration for cross-agent session discovery (`agy`, `opencode`, `freebuff`, `grok`).
  - Systemd user service unit (`agentdesk.service`).
  - Token-based authentication with auto-cookie session persistence over Tailscale.
