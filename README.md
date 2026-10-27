# AgentDesk 📱⚡

**Mobile Control Cockpit for Local AI Coding Agents**

Control, monitor, and coordinate your local AI coding agents (Antigravity CLI, Freebuff, OpenCode, Claude Code) from your Android phone over a private, end-to-end encrypted Tailscale mesh.

## Features

- 🟢 **Live Agent Cockpit**: Watch active agents and panes running in Herdr in real-time.
- 🔔 **Instant Approval Alerts**: Get notified immediately when an agent is waiting for tool approval or user guidance.
- 🔍 **Universal History Search**: Search past sessions, transcripts, and code diffs across all coding agents via AgentR.
- 🔄 **One-Tap Handoff**: Seamlessly transfer tasks between agents on the fly.
- 📱 **Dual Delivery**: Install instantly as a Progressive Web App (PWA) on your phone today, or build a native Android APK with Jetpack Compose.

## Architecture

```
[ Android Phone (Pixel) ] ──(Tailscale 100.x.x.x)──> [ AgentDesk Daemon (:9876) ]
                                                              │
                                       ┌──────────────────────┴──────────────────────┐
                                       ▼                                             ▼
                             Herdr UNIX Socket                             AgentR Python Engine
                         (Live panes & streaming)                       (Session history & handoffs)
```

## Quick Start

```bash
# Run server
python3 -m agentdesk.server

# Run tests
python3 -m unittest discover tests
```
