#!/usr/bin/env python3
"""Home Temporary Chat — ephemeral LAN chat server."""

import hashlib
import ipaddress
import os
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml
from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask_socketio import SocketIO, disconnect, emit

# ── Load config ──────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.yaml"


def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


CFG = load_config()

# ── App setup ────────────────────────────────────────────────────────────────

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = secrets.token_hex(32)

socketio = SocketIO(app, async_mode="gevent", cors_allowed_origins="*", max_http_buffer_size=CFG["uploads"]["max_file_size_mb"] * 1024 * 1024)

UPLOAD_DIR = ROOT / CFG["uploads"]["upload_dir"]
UPLOAD_DIR.mkdir(exist_ok=True)

# ── In-memory store ──────────────────────────────────────────────────────────

messages = []  # list of dicts
messages_lock = threading.Lock()
online_users = {}  # sid -> username


# ── Helpers ──────────────────────────────────────────────────────────────────


def is_allowed_network(ip_str: str) -> bool:
    """Check if the client IP is within allowed subnets."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for subnet_str in CFG["network"]["allowed_subnets"]:
        if ip in ipaddress.ip_network(subnet_str, strict=False):
            return True
    return False


def purge_expired():
    """Background thread: remove messages older than TTL and their files."""
    ttl = CFG["chat"]["message_ttl_seconds"]
    while True:
        time.sleep(5)
        now = time.time()
        to_remove = []
        with messages_lock:
            while messages and (now - messages[0]["ts"]) > ttl:
                msg = messages.pop(0)
                to_remove.append(msg)
            # also cap max
            max_msgs = CFG["chat"]["max_messages"]
            while len(messages) > max_msgs:
                msg = messages.pop(0)
                to_remove.append(msg)

        # clean up files outside lock
        for msg in to_remove:
            if msg.get("file_id"):
                fpath = UPLOAD_DIR / msg["file_id"]
                fpath.unlink(missing_ok=True)

        if to_remove:
            socketio.emit("messages_purged", {
                "removed_ids": [m["id"] for m in to_remove],
            })


# ── Middleware ────────────────────────────────────────────────────────────────


@app.before_request
def check_network():
    client_ip = request.remote_addr
    if not is_allowed_network(client_ip):
        abort(403, "Access denied: not on the local network")


# ── Routes ───────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    if not session.get("authed"):
        return redirect(url_for("login"))
    return render_template("chat.html", config=CFG)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        pw = request.form.get("password", "")
        if pw == CFG["auth"]["password"]:
            session["authed"] = True
            session["username"] = request.form.get("username", "anon").strip()[:20] or "anon"
            return redirect(url_for("index"))
        error = "Wrong password"
    return render_template("login.html", error=error, config=CFG)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/upload", methods=["POST"])
def upload_file():
    if not session.get("authed"):
        abort(401)
    if not CFG["uploads"]["enabled"]:
        abort(403, "Uploads disabled")

    f = request.files.get("file")
    if not f or not f.filename:
        abort(400, "No file")

    max_bytes = CFG["uploads"]["max_file_size_mb"] * 1024 * 1024
    f.seek(0, os.SEEK_END)
    size = f.tell()
    f.seek(0)
    if size > max_bytes:
        abort(413, "File too large")

    allowed = CFG["uploads"]["allowed_extensions"]
    if allowed:
        ext = Path(f.filename).suffix.lower().lstrip(".")
        if ext not in allowed:
            abort(415, f"Extension .{ext} not allowed")

    file_id = f"{uuid.uuid4().hex}_{f.filename}"
    save_path = UPLOAD_DIR / file_id
    f.save(save_path)

    return jsonify({"file_id": file_id, "filename": f.filename, "size": size})


@app.route("/files/<path:file_id>")
def serve_file(file_id):
    if not session.get("authed"):
        abort(401)
    return send_from_directory(UPLOAD_DIR, file_id)


# ── WebSocket events ─────────────────────────────────────────────────────────


@socketio.on("connect")
def ws_connect():
    if not session.get("authed"):
        disconnect()
        return
    username = session.get("username", "anon")
    online_users[request.sid] = username
    emit("history", messages)
    emit("user_count", {"count": len(online_users)}, broadcast=True)


@socketio.on("disconnect")
def ws_disconnect():
    online_users.pop(request.sid, None)
    emit("user_count", {"count": len(online_users)}, broadcast=True)


@socketio.on("send_message")
def ws_message(data):
    if not session.get("authed"):
        disconnect()
        return

    text = (data.get("text") or "").strip()
    file_id = data.get("file_id")
    filename = data.get("filename")

    if not text and not file_id:
        return

    max_len = CFG["chat"]["max_message_length"]
    if text and len(text) > max_len:
        text = text[:max_len]

    msg = {
        "id": uuid.uuid4().hex,
        "user": session.get("username", "anon"),
        "text": text,
        "file_id": file_id,
        "filename": filename,
        "ts": time.time(),
        "time_str": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
        "ttl": CFG["chat"]["message_ttl_seconds"],
    }

    with messages_lock:
        messages.append(msg)

    emit("new_message", msg, broadcast=True)


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    cfg = load_config()
    # start purge thread
    t = threading.Thread(target=purge_expired, daemon=True)
    t.start()

    print(f"\n  Home Temporary Chat")
    print(f"  ───────────────────────────")
    print(f"  Listening on http://{cfg['server']['host']}:{cfg['server']['port']}")
    print(f"  Local URL: http://{cfg['server']['hostname']}:{cfg['server']['port']}")
    print(f"  Messages expire after {cfg['chat']['message_ttl_seconds']}s")
    print(f"  Password: {'(set)' if cfg['auth']['password'] != 'changeme' else '⚠  using default \"changeme\"'}")
    print()

    socketio.run(
        app,
        host=cfg["server"]["host"],
        port=cfg["server"]["port"],
        debug=False,
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()
