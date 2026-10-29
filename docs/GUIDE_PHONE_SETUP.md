# 📱 60-Second Setup Guide: AgentDesk on Your Phone

Connect your Pixel (or any smartphone) to your laptop's AI coding agents in under a minute with zero complicated configuration.

---

## ⚡ Prerequisites

1. **Tailscale Installed**:
   - Both your laptop and your phone must have **Tailscale** installed and logged into the **same account**.
   - [Get Tailscale for Android (Play Store)](https://play.google.com/store/apps/details?id=com.tailscale.ipn)
   - Ensure Tailscale is toggled **Active / Connected** on both devices.

---

## 🚀 3 Simple Steps

### Step 1: Run the Installer on Your Laptop
Open a terminal on your laptop and run:

```bash
cd ~/Work/agentdesk
./install.sh
```

*(Or if already installed, just type: `agentdesk`)*

You will see an **ANSI QR Code** appear directly in your terminal:

```text
============================================================
  📱 AGENTDESK — SCAN TO CONNECT FROM YOUR PHONE
============================================================
[ QR Code displayed here ]

  Tailscale URL : http://100.77.2.5:9876/?secret=...
============================================================
```

---

### Step 2: Scan with Your Phone Camera
1. Open your phone's **Camera** app (or Google Lens).
2. Point your camera at the QR code on your laptop screen.
3. Tap the link that pops up. It will open in **Google Chrome**.

---

### Step 3: Install as an App (PWA)
1. In Chrome on your phone, tap the **three-dot menu (`⋮`)** in the top right.
2. Tap **"Install app"** (or **"Add to Home screen"**).
3. Tap **Install**.

🎉 **That's it!** An **AgentDesk** icon is now in your phone's app drawer. When you tap it:
- It launches in **fullscreen** (no browser search bar or navigation clutter).
- It looks and behaves like a native dark-mode terminal multiplexer.
- It automatically updates whenever your laptop server is updated.

---

## 🎮 How to Use from Your Phone

| Action | How to do it |
|---|---|
| **Filter Workspaces** | Tap any tab at the top (`[ 1: ~General ]`, `[ 2: ~AgentR ]`, etc.) to view only that workspace's panes. |
| **Inspect a Terminal** | Tap **`> PEEK`** on any card to slide up the live streaming terminal buffer. |
| **Send a Prompt** | In the peek drawer, type in the text box `> send text or prompt...` and tap **SEND** (or press Enter on your phone keyboard). It submits directly to the agent. |
| **One-Tap Approval** | Tap **`> APPROVE (y)`** on the card, or in the peek drawer tap **`[ y + ↵ ]`**. |
| **Interrupt / Abort** | Tap **`> ABORT (^C)`** or the **`[ ^C Abort ]`** button to cancel a runaway process or command. |
| **Search Transcripts** | Tap the **`[ 🔍 2:SESSIONS ]`** tab at the bottom to search across all past coding agent sessions (`agy`, `opencode`, `freebuff`, `grok`). |

---

## 🛠️ Troubleshooting

- **Phone says "Site can't be reached"**:
  - Open the Tailscale app on your phone and ensure the VPN switch is **Connected**.
  - Check that your laptop is also connected: run `agentdesk status` on your laptop.
- **Unauthorized (401 Error)**:
  - You might be missing the security token. Run `agentdesk qr` on your laptop and rescan the QR code to refresh your session cookie.
- **Service not responding**:
  - Run `agentdesk restart` on your laptop to restart the background service.
