#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# home-temporary-chat — setup, start, and stop
# Usage: ./setup.sh [start|stop|status]
#   (no argument = start)
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

HOSTNAME_CFG=$(grep -oP 'hostname:\s*"\K[^"]+' "$CONFIG" 2>/dev/null || echo "chat.home")
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' || ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)

# ── Stop / uninstall ────────────────────────────────────────
do_stop() {
    info "Stopping home-chat..."

    # Stop and disable systemd service
    if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
        sudo systemctl stop ${SERVICE_NAME}
        info "Service stopped"
    else
        info "Service was not running"
    fi

    if systemctl is-enabled --quiet ${SERVICE_NAME} 2>/dev/null; then
        sudo systemctl disable ${SERVICE_NAME}
        info "Service disabled (won't start on boot)"
    fi

    # Remove systemd unit file
    if [ -f /etc/systemd/system/${SERVICE_NAME}.service ]; then
        sudo rm /etc/systemd/system/${SERVICE_NAME}.service
        sudo systemctl daemon-reload
        info "Service file removed"
    fi

    # Remove /etc/hosts entry
    if grep -q "$HOSTNAME_CFG" /etc/hosts 2>/dev/null; then
        sudo sed -i "/$HOSTNAME_CFG/d" /etc/hosts
        info "Removed '$HOSTNAME_CFG' from /etc/hosts"
    fi

    # Clean up uploads
    if [ -d "$SCRIPT_DIR/uploads" ]; then
        rm -rf "$SCRIPT_DIR/uploads"
        info "Uploads directory cleaned"
    fi

    echo ""
    echo -e "${GREEN}  Home Temporary Chat fully stopped and cleaned up.${NC}"
    echo ""
}

# ── Status ───────────────────────────────────────────────────
do_status() {
    if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
        info "Service is running"
        systemctl status ${SERVICE_NAME} --no-pager
    else
        warn "Service is not running"
    fi
}

# ── Start / install ─────────────────────────────────────────
do_start() {
    # Check dependencies
    command -v python3 >/dev/null || { error "python3 not found"; exit 1; }

    # Create virtual environment
    if [ ! -d "$VENV_DIR" ]; then
        info "Creating virtual environment..."
        python3 -m venv "$VENV_DIR"
    fi

    info "Installing dependencies..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip
    "$VENV_DIR/bin/pip" install --quiet flask flask-socketio pyyaml gevent gevent-websocket

    # Create uploads dir
    mkdir -p "$SCRIPT_DIR/uploads"

    # Setup local DNS
    if ! grep -q "$HOSTNAME_CFG" /etc/hosts 2>/dev/null; then
        warn "Adding '$HOSTNAME_CFG' to /etc/hosts (requires sudo)..."
        echo "$LOCAL_IP    $HOSTNAME_CFG" | sudo tee -a /etc/hosts >/dev/null
        info "Added: $LOCAL_IP -> $HOSTNAME_CFG"
    else
        info "$HOSTNAME_CFG already in /etc/hosts"
    fi

    # Install systemd service
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
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}.service
    sudo systemctl restart ${SERVICE_NAME}.service

    # Summary
    PORT=$(grep -oP 'port:\s*\K\d+' "$CONFIG" 2>/dev/null || echo "80")
    if [ "$PORT" = "80" ]; then
        PORT_SUFFIX=""
    else
        PORT_SUFFIX=":${PORT}"
    fi

    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Home Temporary Chat is running!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  Local URL:   http://${HOSTNAME_CFG}${PORT_SUFFIX}"
    echo -e "  IP URL:      http://${LOCAL_IP}${PORT_SUFFIX}"
    echo -e "  Service:     systemctl status ${SERVICE_NAME}"
    echo -e "  Stop:        ./setup.sh stop"
    echo ""
    echo -e "  ${YELLOW}Tip: Other devices on your network need to add"
    echo -e "  this line to their /etc/hosts (or use the IP):${NC}"
    echo -e "  ${LOCAL_IP}    ${HOSTNAME_CFG}"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────
case "${1:-start}" in
    start)  do_start ;;
    stop)   do_stop ;;
    status) do_status ;;
    *)
        echo "Usage: $0 [start|stop|status]"
        exit 1
        ;;
esac
