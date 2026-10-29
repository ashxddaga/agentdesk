# 🗺️ AgentDesk Roadmap

This document outlines the architectural roadmap, planned features, and milestones for AgentDesk.

---

## 📍 High-Level Progress Overview

| Phase | Focus Area | Status | Target |
|---|---|---|---|
| **Phase 1** | Foundation: Herdr Socket, AgentR Bridge, TUI Design, Browser E2E Test | ✅ Completed | v0.1.x |
| **Phase 2** | Zero-Config Onboarding: Terminal QR Code, CLI Manager, Guides | ✅ Completed | v0.2.x |
| **Phase 3** | Remote Alerts & Ergonomics: Lock-Screen Push Notifications, Audio Chimes & Chips | ✅ Completed | v0.3.x |
| **Phase 4** | Remote Agent Lifecycle: Remote Launcher, Process Termination & Kill | ✅ Completed | v0.3.x |
| **Phase 5** | Autonomous Run Supervision: Live Metrics, Token Cost & Task Blackboard | ✅ Completed | v0.3.x |
| **Phase 6** | Advanced Mobile Ergonomics: Multi-Pane Stacked Peek, Offline Synced Buffers | 📅 Planned | v0.4.x |

---

## ✅ Phase 1: Core Foundation (Completed)

- [x] Zero-dependency Python daemon (`agentdesk/server.py`) serving REST API, SSE event streams, and static assets.
- [x] Unix socket & CLI bridge (`agentdesk/herdr_bridge.py`) for Herdr session snapshots and pane streaming.
- [x] AgentR integration (`agentdesk/agentr_bridge.py`) for fuzzy session search across `agy`, `opencode`, `freebuff`, and `grok`.
- [x] Authentic Herdr terminal / TUI visual overhaul (`#07090e`, monospace, phosphor status dots, workspace tabs).
- [x] Fixed prompt submission via socket RPC (`pane.send_text` + discrete `pane.send_keys ['enter']`).
- [x] Discrete control keys endpoint (`/api/keys` for `ctrl+c`, `enter`, `esc`).
- [x] Native Jetpack Compose Android client scaffold (`com.agentdesk.app`).
- [x] Automated mobile browser end-to-end test suite (`tests/test_e2e_browser.py`) integrated into `./run_tests.sh`.
- [x] User systemd service installation (`agentdesk.service`).

---

## ✅ Phase 2: Zero-Config Onboarding (Completed)

- [x] **Terminal ANSI QR Code**: `agentdesk qr` generates an instant high-contrast QR code directly in the terminal for camera scanning.
- [x] **Dynamic Tailscale IP Discovery**: Auto-detects active Tailscale IPv4 address (`tailscale ip -4`) without hardcoded IPs.
- [x] **Unified CLI Manager (`agentdesk`)**: Single command tool (`status`, `qr`, `restart`, `logs`, `test`, `start`, `stop`).
- [x] **Beginner Phone Setup Guide**: [`docs/GUIDE_PHONE_SETUP.md`](GUIDE_PHONE_SETUP.md) for 60-second onboarding.
- [x] **Professional Developer Documentation Contract**: Documented in `AGENTS.md` and tracked in `CHANGELOG.md`.

---

## ✅ Phase 3: Remote Alerts & Mobile Ergonomics (Completed)

- [x] **Lock-Screen Push Notifications**: Service Worker push notification handler in `web/sw.js` with vibration pattern `[200, 100, 200]`.
- [x] **Tactile Haptic & Web Audio Chimes**: Synthesized triangle-wave audio chime (440Hz -> 880Hz) on approval requests and completions.
- [x] **Audio & Push Alert Toggle**: Header switch `[ 🔔 ON ]` / `[ 🔕 OFF ]` storing state in `localStorage`.
- [x] **Voice-to-Text Dictation**: Mobile microphone button (`🎙️`) leveraging `webkitSpeechRecognition`.
- [x] **Quick Macro Prompt Chips**: One-tap prompt chips: `[ Continue ]`, `[ Run tests ]`, `[ Fix & retry ]`, `[ Git status ]`, `[ Explain ]`.

---

## ✅ Phase 4: Remote Agent Lifecycle Control (Completed)

- [x] **Remote Workspace & Agent Launcher**: Modal launcher (`[ + LAUNCH ]`) querying `GET /api/workdirs`, picking agent flavors (`agy`, `opencode`, `freebuff`, `grok`, `bash`), and calling `POST /api/agents/launch`.
- [x] **Process Management & Emergency Kill**: `POST /api/pane/{id}/kill` sending clean `SIGINT` or `SIGKILL` to foreground process via Herdr RPC.
- [x] **Emergency Stop Button**: Dedicated `[ 🛑 KILL ]` button in terminal drawer header with confirmation safeguard.

---

## ✅ Phase 5: Autonomous Long Run Supervision (Completed)

- [x] **Autonomous Run Watchdog**: Threaded `AutonomousWatchdog` tracking durations, turns, and token estimates in `agentdesk/server.py`.
- [x] **Live Pane Telemetry Badges**: Displays execution duration (`⏱️ 4m 12s`), turns count, and token estimates (`~18k tok`) on each pane card.
- [x] **AgentR Task Blackboard Overlay**: Accessible via `[ 📋 BOARD ]` header button, allowing live task status changes and feedback notes.
- [x] **End-of-Run Real-Time Alerts**: Dispatches `run.completed` events via SSE stream and triggers phone chimes.

---

## 📅 Phase 6: Advanced Mobile Ergonomics (Next)

1. **Multi-Pane Stacked Peek**: Pin 2 active panes side-by-side or stacked on tablets/foldables.
2. **Offline Synced Buffers**: Cache terminal history offline in IndexedDB for flaky cell connections.
3. **Smart Token Billing Breakdown**: Granular cost calculation per model provider.
