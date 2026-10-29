# 🗺️ AgentDesk Roadmap

This document outlines the architectural roadmap, planned features, and milestones for AgentDesk.

---

## 📍 High-Level Progress Overview

| Phase | Focus Area | Status | Target |
|---|---|---|---|
| **Phase 1** | Foundation: Herdr Socket, AgentR Bridge, TUI Design, Browser E2E Test | ✅ Completed | v0.1.x |
| **Phase 2** | Zero-Config Onboarding: Terminal QR Code, CLI Manager, Guides | ✅ Completed | v0.2.x |
| **Phase 3** | Remote Alerts & Ergonomics: Lock-Screen Push Notifications & Haptics | 🚧 In Progress | v0.3.x |
| **Phase 4** | Remote Agent Lifecycle: Remote Launcher, Process Termination, Split Peek | 📅 Planned | v0.4.x |
| **Phase 5** | Autonomous Run Supervision: Live Metrics, Token Cost, Task Board Reintroduction | 📅 Planned | v0.5.x |

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

## ✅ Phase 2: Zero-Config Onboarding (Delivered)

- [x] **Terminal ANSI QR Code**: `agentdesk qr` generates an instant high-contrast QR code directly in the terminal for camera scanning.
- [x] **Dynamic Tailscale IP Discovery**: Auto-detects active Tailscale IPv4 address (`tailscale ip -4`) without hardcoded IPs.
- [x] **Unified CLI Manager (`agentdesk`)**: Single command tool (`status`, `qr`, `restart`, `logs`, `test`, `start`, `stop`).
- [x] **Beginner Phone Setup Guide**: [`docs/GUIDE_PHONE_SETUP.md`](GUIDE_PHONE_SETUP.md) for 60-second onboarding.
- [x] **Professional Developer Documentation Contract**: Documented in `AGENTS.md` and tracked in `CHANGELOG.md`.

---

## 🚧 Phase 3: Remote Alerts & Mobile Ergonomics (Current Focus)

*Goal: Ensure you never miss an agent waiting for approval, even when your phone is in your pocket or the screen is locked.*

1. **Lock-Screen Push Notifications (Web Push / NTFY Bridge)**:
   - Implement Web Push API / Service Worker notification payload when a pane transitions to `agent_status: "blocked"`.
   - Optional local fallback via unified push protocol or native Android broadcast receiver.
2. **Tactile Haptic & Audio Chime Settings**:
   - Customizable sound cues (subtle terminal blip) and haptic pulse patterns when tool approval is requested.
   - Toggle switch in header: `[ Sound: ON/OFF ]` `[ Haptic: ON/OFF ]`.
3. **Voice-to-Text Prompting**:
   - Mobile microphone button to dictate prompts using mobile keyboard speech-to-text without syntax distortion.
4. **Quick Macro Prompt Chips**:
   - Configurable quick prompt chips below the input box (e.g. `[ Continue ]`, `[ Run Tests ]`, `[ Fix & Retry ]`, `[ Git Status ]`).

---

## 📅 Phase 4: Remote Agent Lifecycle Control

*Goal: Manage, spawn, and recover agent processes from your phone without returning to your physical desk.*

1. **Remote Workspace & Agent Launcher**:
   - Ability to launch a new agent session in any repository under `~/Work/` directly from the mobile UI.
   - Choose agent flavor (`agy`, `opencode`, `freebuff`, `bash`) and workspace target.
2. **Process Management & Emergency Kill**:
   - Safe process restart and emergency termination (`SIGTERM` / `SIGKILL`) for runaway or hung scripts.
3. **Multi-Pane Stacked Peek**:
   - Ability to pin 2 active panes side-by-side or stacked in a split monitor view on tablets/foldables.
4. **Dynamic Output Filters**:
   - Toggle to filter ANSI color noise or strip verbose build output to focus strictly on agent thoughts and errors.

---

## 📅 Phase 5: Autonomous Long Run Supervision

*Goal: Safely leave agents building complex architectures overnight or while commuting, with full transparency.*

1. **Autonomous Run Watchdog**:
   - Background monitor detecting stalled sessions (e.g. no output for 10 minutes) with auto-alerts to phone.
2. **Context Window & Token Meter**:
   - Real-time gauge of context token usage and estimated API cost per session.
3. **Re-introduction of the Multi-Agent Task Board**:
   - Once long autonomous multi-agent runs are verified and stable, re-enable the blackboard tab with live milestone Gantt / task progress.
4. **End-of-Run Summary Push**:
   - Automatically compile a bulleted summary of files changed, commits made, and tests passing once `/goal` completes.
