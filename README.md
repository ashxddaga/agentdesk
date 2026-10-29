# AgentDesk 📱⚡

**Mobile Control Cockpit for Local AI Coding Agents**

Control, monitor, and approve local AI coding agents (`agy` / Antigravity CLI, `opencode`, `freebuff`, `grok`) from your phone over a private, end-to-end encrypted Tailscale network.

Featuring an authentic **Herdr terminal / TUI aesthetic** with live streaming terminal peek, tactile macro keys, and cross-agent session search.

---

## ⚡ 60-Second Quick Start

1. Install and start the background service on your workstation:
   ```bash
   cd ~/Work/agentdesk
   ./install.sh
   ```
2. Scan the **ANSI QR Code** that appears in your terminal with your phone camera.
3. In Chrome on your phone, tap **`⋮` -> "Install app"** to add it to your home screen!

👉 Full step-by-step walkthrough: **[Phone Setup Guide](docs/GUIDE_PHONE_SETUP.md)**

---

## 🛠️ CLI Management

Once installed, manage AgentDesk anytime from your terminal:

```bash
agentdesk            # Display the terminal QR code & connection URL
agentdesk status     # Check background service status and active Herdr panes
agentdesk restart    # Restart the background daemon
agentdesk logs       # View live daemon logs
agentdesk test       # Run unit tests + automated browser E2E tests
```

---

## 📱 Features

- **Authentic Herdr TUI**: Deep phosphor terminal theme (`#07090e`), workspace tab strip, monospace typography.
- **One-Tap Tool Approvals**: High-visibility banner when an agent needs confirmation, with one-tap `[ > APPROVE (y) ]` and `[ > ABORT (^C) ]`.
- **Live Terminal Peek & Macro Keypad**: Monospace buffer viewer with tactile buttons: `[ y + ↵ ]`, `[ ↵ Enter ]`, `[ n ]`, `[ ^C Abort ]`, `[ Esc ]`, and prompt runner.
- **Cross-Agent Session Search**: Real-time fuzzy transcript search across `agy`, `opencode`, `freebuff`, and `grok` powered by AgentR.
- **Automated Browser E2E Pipeline**: Every release is verified using `agent-browser` automation against a real mobile viewport.

---

## 🏗️ Architecture

```text
[ Android Phone (Pixel) ] ──(Tailscale Mesh 100.x.x.x:9876)──> [ AgentDesk Daemon ]
                                                                       │
                                              ┌────────────────────────┴────────────────────────┐
                                              ▼                                                 ▼
                                    Herdr UNIX Domain Socket                          AgentR Python Engine
                                   (~/.config/herdr/herdr.sock)                         (Session Search)
```

---

## 🧪 Testing Pipeline

AgentDesk includes backend unit tests and automated mobile browser E2E tests:

```bash
./run_tests.sh
# or: python3 -m unittest discover tests -v
```

---

## 📚 Documentation & Roadmap

- **[60-Second Phone Setup Guide](docs/GUIDE_PHONE_SETUP.md)**: Zero-friction onboarding for phone setup.
- **[Product & Engineering Roadmap](docs/ROADMAP.md)**: Overview of completed, in-progress, and future milestones.
- **[Changelog & Incident RCA Log](CHANGELOG.md)**: Professional software developer log of all issues, root causes, and resolutions.
- **[Developer Contract](AGENTS.md)**: Rules and guidelines for agents and contributors working in this repository.
