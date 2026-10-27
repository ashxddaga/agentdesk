# agentdesk — Mobile Control Cockpit for Local AI Agents

Mobile web cockpit (PWA) and Android app bridge for real-time monitoring,
tool approval, and cross-agent coordination across Herdr and AgentR.

## 1. What is this?

A dual-tier system:
1. **Laptop Daemon (`agentdesk`)**: Lightweight Python service exposing REST & SSE
   endpoints over Tailscale, integrating Herdr's live socket (`~/.config/herdr/herdr.sock`)
   with AgentR's cross-agent session engine.
2. **Mobile Cockpit (`web/` & `android/`)**: Touch-optimized web app (PWA) and
   Jetpack Compose Android client for live agent monitoring, approval buttons,
   and one-tap session handoffs.

## 2. How to run and test it

Run daemon locally:
```bash
python3 -m agentdesk.server
```

Run test suite:
```bash
python3 -m unittest discover tests
```

Install as systemd user service:
```bash
./install.sh
systemctl --user status agentdesk
```

Access from phone over Tailscale:
```
http://100.77.2.5:9876/?secret=<secret>
```

## 3. Where does its data live?

- Config & Secret: `~/.config/agentdesk/config.json` (gitignored).
- Herdr UNIX Socket: `~/.config/herdr/herdr.sock`.
- Agent sessions: Reads via `agentr` from native agent databases in `~/.gemini/`
  and `~/.local/share/opencode/`.

## 4. What must I not touch?

- Never commit secrets or private tokens (`config.json`).
- All Herdr socket mutations must respect Herdr client protocol.
- Keep the server dependencies zero-bloat (Python 3 stdlib only).
