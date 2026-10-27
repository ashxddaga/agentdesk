# AgentDesk Android Native App (Jetpack Compose)

This directory contains a complete native Android application structured with **Kotlin** and **Jetpack Compose**.

## Features

- **Direct Tailscale Connect**: Communicates over `100.77.2.5:9876` directly with your laptop's AgentDesk daemon.
- **Active Agent Cards**: Live status chips (`working`, `idle`, `blocked`).
- **One-Tap Approvals**: Prominent action banner when an agent needs confirmation.
- **Terminal Peek**: Read unwrapped terminal output in a native bottom sheet.

## Building / Publishing via AI Studio or Android Studio

1. **In Google AI Studio / Project IDX**:
   - Open or import this directory (`~/Work/agentdesk/android`).
   - Use the build prompt: *"Build APK for AgentDesk"* or export the project.
2. **In Android Studio**:
   - Select **File -> Open...** and choose `~/Work/agentdesk/android`.
   - Click **Run** or **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**.
   - Install the generated `.apk` directly onto your Pixel phone!
