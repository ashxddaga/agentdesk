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

Run test suite (Backend Unit Tests + Browser E2E Tests):
```bash
./run_tests.sh
```

Run mandatory pre-push CI gate & quality audit:
```bash
./bin/ci
```
The automated CI gate enforces 6 mandatory checks before any push:
1. Python compilation integrity (`py_compile`)
2. Zero external dependencies audit (stdlib only)
3. Secret and credential leak scan
4. 22 Unit and Browser E2E tests (`./run_tests.sh`)
5. 19 Agentic UI capabilities via `agent-browser` (`./bin/agentic-tester`)
6. Git working tree cleanliness and hygiene

A git pre-push hook is installed at `.git/hooks/pre-push` to automatically run `./bin/ci` prior to `git push`.

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

## 5. Developer & Documentation Contract

Every issue, user feedback item, root cause analysis (RCA), and bug fix MUST be documented in `CHANGELOG.md`:
- **Issue & Symptom**: What behavior was observed or reported.
- **Root Cause Analysis (RCA)**: Technical reason for the failure.
- **Fix & Implementation**: Exact code, configuration, or architectural fix.
- **Verification**: Tests and commands used to verify resolution (must pass `./run_tests.sh`).
- **Git Commit**: Every multi-file change must be cleanly committed and pushed to git.
