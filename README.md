# Home Temporary Chat

> **Ephemeral, self-destructing chat for your home network.**
> Share files, keys, passwords, and secrets between your devices — everything vanishes in 2 minutes.

---

## Why?

You're on your couch with your phone and need to send an SSH key to your laptop. Or paste a password from your desktop to your tablet. Or share a config file between machines.

You could email it to yourself. You could use a cloud service. You could set up Syncthing. But all of those leave traces — in sent folders, cloud logs, sync histories.

**Home Temporary Chat** is a zero-trace dead drop for your local network:

- Messages **self-destruct** after a configurable TTL (default: 2 minutes)
- Files are **deleted from disk** when they expire
- **No database**, no logs, no persistence — everything lives in memory
- **Password-protected** — only people with the password can enter
- **LAN-only** — refuses connections from outside your home network
- Runs on a single machine, reachable from any device on your Wi-Fi

### Inspiration & Use Cases

- **SSH keys**: Generate a key pair on one machine, paste the public key into chat, grab it from another device, done. Gone in 2 minutes.
- **API tokens & secrets**: Need to move a `.env` file or API key between machines? Drop it in chat, pull it from the other side.
- **Wi-Fi passwords**: Guest asks for the Wi-Fi password? Drop it in chat with a short-lived link.
- **Config files**: Share `~/.config/something` between your desktop and laptop without cloud sync.
- **One-time passwords / 2FA recovery codes**: Securely move them between devices.
- **Quick file transfers**: Drag-and-drop any file up to 50MB — PDFs, images, archives — gone after 2 minutes.
- **Clipboard bridge**: Copy text on your phone, paste it in chat, grab it on your laptop. Like a universal clipboard that doesn't require an Apple/Google account.

The key idea: **if it doesn't need to persist, it shouldn't.**

---

## Quick Start

### One-command setup (Arch Linux)

```bash
git clone https://github.com/youruser/home-temporary-chat.git
cd home-temporary-chat

# Edit the password first!
nano config.yaml

# Run setup (installs deps, systemd service, local DNS)
./setup.sh
```

That's it. Open `http://chat.home:8443` on any device on your network.

### Manual run (without systemd)

```bash
python3 -m venv .venv
.venv/bin/pip install flask flask-socketio pyyaml gevent gevent-websocket
.venv/bin/python3 server.py
```

---

## Configuration

Everything is controlled via `config.yaml`:

```yaml
server:
  host: "0.0.0.0"
  port: 8443
  hostname: "chat.home"

auth:
  password: "changeme"         # CHANGE THIS

chat:
  message_ttl_seconds: 120     # 2 minutes
  max_messages: 200
  max_message_length: 5000

uploads:
  enabled: true
  max_file_size_mb: 50
  allowed_extensions: []       # empty = allow all
  upload_dir: "uploads"

network:
  allowed_subnets:
    - "192.168.0.0/16"
    - "10.0.0.0/8"
    - "172.16.0.0/12"
    - "127.0.0.0/8"

ui:
  title: "Home Chat"
  theme: "dark"                # "dark" or "light"
  show_timestamps: true
```

Changes to `config.yaml` take effect on restart:

```bash
sudo systemctl restart home-chat
```

---

## Setting Up `chat.home` DNS

### On the server (done by `setup.sh`)

The setup script adds an entry to `/etc/hosts` automatically.

### On other devices

Add this line to each device's hosts file (replace the IP with your server's LAN IP):

| OS          | File                              |
|-------------|-----------------------------------|
| Linux/Mac   | `/etc/hosts`                      |
| Windows     | `C:\Windows\System32\drivers\etc\hosts` |
| Android     | Requires root, or use the IP directly |
| iOS         | Use the IP directly               |

```
192.168.1.100    chat.home
```

**Alternative: Use a local DNS server** (dnsmasq, Pi-hole, AdGuard Home) to resolve `chat.home` network-wide without editing each device.

---

## Auto-Start on Boot

The `setup.sh` script installs and enables a systemd service. The chat server starts automatically on every boot.

```bash
# Check status
sudo systemctl status home-chat

# View logs
journalctl -u home-chat -f

# Stop
sudo systemctl stop home-chat

# Disable auto-start
sudo systemctl disable home-chat
```

---

## Security Notes

- This is for **home network use only**. It binds to all interfaces but rejects connections from outside your configured subnets.
- The password is stored in plaintext in `config.yaml`. This is intentional — it's a simple shared secret for your household, not a production auth system.
- There is no TLS by default. If you want HTTPS, put it behind a reverse proxy (nginx/caddy) with a self-signed cert.
- **Nothing is stored on disk** except uploaded files (which are deleted when they expire). There is no database, no log file, no chat history.

---

## License

MIT
