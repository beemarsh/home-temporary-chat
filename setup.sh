#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# home-temporary-chat — one-command setup for Arch Linux
# ─────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="home-chat"
VENV_DIR="$SCRIPT_DIR/.venv"
CONFIG="$SCRIPT_DIR/config.yaml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; }

# ── Check dependencies ───────────────────────────────────
command -v python3 >/dev/null || { error "python3 not found"; exit 1; }

# ── Create virtual environment ───────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    info "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

info "Installing dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet flask flask-socketio pyyaml gevent gevent-websocket

# ── Create uploads dir ───────────────────────────────────
mkdir -p "$SCRIPT_DIR/uploads"

# ── Setup local DNS (chat.home) ──────────────────────────
HOSTNAME=$(grep -oP 'hostname:\s*"\K[^"]+' "$CONFIG" 2>/dev/null || echo "chat.home")
LOCAL_IP=$(hostname -I | awk '{print $1}')

if ! grep -q "$HOSTNAME" /etc/hosts 2>/dev/null; then
    warn "Adding '$HOSTNAME' to /etc/hosts (requires sudo)..."
    echo "$LOCAL_IP    $HOSTNAME" | sudo tee -a /etc/hosts >/dev/null
    info "Added: $LOCAL_IP -> $HOSTNAME"
else
    info "$HOSTNAME already in /etc/hosts"
fi

# ── Install systemd service ──────────────────────────────
info "Installing systemd service..."

sudo tee /etc/systemd/system/${SERVICE_NAME}.service >/dev/null <<UNIT
[Unit]
Description=Home Temporary Chat
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python3 $SCRIPT_DIR/server.py
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service
sudo systemctl restart ${SERVICE_NAME}.service

# ── Summary ──────────────────────────────────────────────
PORT=$(grep -oP 'port:\s*\K\d+' "$CONFIG" 2>/dev/null || echo "8443")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Home Temporary Chat is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Local URL:   http://${HOSTNAME}:${PORT}"
echo -e "  IP URL:      http://${LOCAL_IP}:${PORT}"
echo -e "  Service:     systemctl status ${SERVICE_NAME}"
echo ""
echo -e "  ${YELLOW}Tip: Other devices on your network need to add"
echo -e "  this line to their /etc/hosts (or use the IP):${NC}"
echo -e "  ${LOCAL_IP}    ${HOSTNAME}"
echo ""
