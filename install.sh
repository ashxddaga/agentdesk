#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/agentdesk"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
LOCAL_BIN="$HOME/.local/bin"

mkdir -p "$CONFIG_DIR" "$SYSTEMD_USER_DIR" "$LOCAL_BIN"

# Generate or preserve config with shared secret
if [ ! -f "$CONFIG_DIR/config.json" ]; then
    SECRET="63df263a-e1e4-4854-998c-7b1e8ce33dd4"
    cat > "$CONFIG_DIR/config.json" <<EOF
{
  "bind": "0.0.0.0",
  "port": 9876,
  "secret": "$SECRET",
  "socket": "$HOME/.config/herdr/herdr.sock",
  "workspace": "$HOME/Work"
}
EOF
    echo "✓ Created config at $CONFIG_DIR/config.json (bound to 0.0.0.0:9876)"
fi

# Stop legacy prototype service if running to release port 9876
if systemctl --user is-active --quiet herdr-phone.service 2>/dev/null; then
    echo "Stopping legacy herdr-phone.service to free port 9876..."
    systemctl --user stop herdr-phone.service || true
    systemctl --user disable herdr-phone.service || true
fi

# Link CLI executable to ~/.local/bin/agentdesk
ln -sfn "$HERE/bin/agentdesk" "$LOCAL_BIN/agentdesk"
echo "✓ Installed CLI tool: 'agentdesk' -> $LOCAL_BIN/agentdesk"

# Link systemd service
ln -sfn "$HERE/systemd/agentdesk.service" "$SYSTEMD_USER_DIR/agentdesk.service"

# Reload and start service
systemctl --user daemon-reload
systemctl --user enable --now agentdesk.service
echo "✓ Systemd service 'agentdesk.service' is active and enabled"

# Show QR and connection info
"$HERE/bin/agentdesk" qr
