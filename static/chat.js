(() => {
    "use strict";

    const socket = io();
    const messagesList = document.getElementById("messagesList");
    const messagesContainer = document.getElementById("messagesContainer");
    const messageInput = document.getElementById("messageInput");
    const btnSend = document.getElementById("btnSend");
    const btnAttach = document.getElementById("btnAttach");
    const fileInput = document.getElementById("fileInput");
    const uploadPreview = document.getElementById("uploadPreview");
    const uploadFilename = document.getElementById("uploadFilename");
    const uploadCancel = document.getElementById("uploadCancel");
    const userCountEl = document.getElementById("userCount");

    let pendingFile = null;
    let myUsername = null;
    const messageTimers = {};  // msgId -> { interval, expireTime }

    // ── Username from cookie/session (injected via page) ──
    // We'll detect "own" messages by matching the username shown in the msg

    // ── Socket events ─────────────────────────────────────

    socket.on("connect", () => {
        console.log("Connected to chat server");
    });

    socket.on("history", (msgs) => {
        messagesList.innerHTML = "";
        if (msgs.length === 0) {
            showEmpty();
        }
        msgs.forEach(addMessage);
        scrollBottom();
    });

    socket.on("new_message", (msg) => {
        removeEmpty();
        addMessage(msg);
        scrollBottom();
    });

    socket.on("user_count", (data) => {
        userCountEl.textContent = `${data.count} online`;
    });

    socket.on("messages_purged", (data) => {
        data.removed_ids.forEach((id) => {
            const el = document.getElementById(`msg-${id}`);
            if (el) {
                el.classList.add("removing");
                clearMessageTimer(id);
                setTimeout(() => el.remove(), 400);
            }
        });
        // Show empty if no messages left
        setTimeout(() => {
            if (messagesList.children.length === 0) showEmpty();
        }, 500);
    });

    // ── Render ─────────────────────────────────────────────

    function addMessage(msg) {
        // Detect own messages
        if (!myUsername) {
            // First message or from history — get our name from the page
            const params = new URLSearchParams(document.cookie);
            // Fallback: we'll just mark the first sent message
        }

        const div = document.createElement("div");
        div.className = "message";
        div.id = `msg-${msg.id}`;

        // Check if it's our own message
        if (msg._own) {
            div.classList.add("own");
        }

        let html = `<div class="msg-header">
            <span class="msg-user">${escHtml(msg.user)}</span>
            <span class="msg-time">${escHtml(msg.time_str)}</span>
            <span class="msg-ttl" id="ttl-${msg.id}"></span>
        </div>`;

        if (msg.text) {
            html += `<div class="msg-text">${escHtml(msg.text)}</div>`;
        }

        if (msg.file_id) {
            html += `<a class="msg-file" href="/files/${encodeURIComponent(msg.file_id)}" download="${escAttr(msg.filename || 'file')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                ${escHtml(msg.filename || "file")}
            </a>`;
        }

        div.innerHTML = html;
        messagesList.appendChild(div);

        // Start TTL countdown
        startTtlCountdown(msg);
    }

    function startTtlCountdown(msg) {
        const expireTime = (msg.ts + msg.ttl) * 1000; // ms
        const ttlEl = () => document.getElementById(`ttl-${msg.id}`);
        const msgEl = () => document.getElementById(`msg-${msg.id}`);

        const update = () => {
            const remaining = Math.max(0, Math.ceil((expireTime - Date.now()) / 1000));
            const el = ttlEl();
            if (el) {
                el.textContent = `${remaining}s`;
            }
            const mel = msgEl();
            if (mel) {
                if (remaining <= 15) mel.classList.add("expiring");
            }
            if (remaining <= 0) {
                clearMessageTimer(msg.id);
            }
        };

        update();
        const interval = setInterval(update, 1000);
        messageTimers[msg.id] = { interval, expireTime };
    }

    function clearMessageTimer(id) {
        if (messageTimers[id]) {
            clearInterval(messageTimers[id].interval);
            delete messageTimers[id];
        }
    }

    function showEmpty() {
        if (document.querySelector(".empty-state")) return;
        const div = document.createElement("div");
        div.className = "empty-state";
        div.innerHTML = `
            <div class="icon">&#x1f4ac;</div>
            <p>No messages yet</p>
            <p style="font-size:0.75rem;">Messages self-destruct automatically</p>
        `;
        messagesList.appendChild(div);
    }

    function removeEmpty() {
        const empty = document.querySelector(".empty-state");
        if (empty) empty.remove();
    }

    function scrollBottom() {
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }

    function escHtml(s) {
        const d = document.createElement("div");
        d.textContent = s || "";
        return d.innerHTML;
    }

    function escAttr(s) {
        return (s || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // ── Send ──────────────────────────────────────────────

    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text && !pendingFile) return;

        let fileData = {};

        if (pendingFile) {
            const formData = new FormData();
            formData.append("file", pendingFile);
            try {
                const resp = await fetch("/upload", { method: "POST", body: formData });
                if (!resp.ok) {
                    alert(`Upload failed: ${resp.statusText}`);
                    return;
                }
                const data = await resp.json();
                fileData = { file_id: data.file_id, filename: data.filename };
            } catch (e) {
                alert(`Upload error: ${e.message}`);
                return;
            }
            clearFile();
        }

        socket.emit("send_message", {
            text: text,
            ...fileData,
        });

        messageInput.value = "";
        messageInput.style.height = "auto";
    }

    // ── File handling ─────────────────────────────────────

    btnAttach.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            pendingFile = fileInput.files[0];
            uploadFilename.textContent = pendingFile.name;
            uploadPreview.style.display = "flex";
        }
    });

    uploadCancel.addEventListener("click", clearFile);

    function clearFile() {
        pendingFile = null;
        fileInput.value = "";
        uploadPreview.style.display = "none";
    }

    // ── Input handling ────────────────────────────────────

    btnSend.addEventListener("click", sendMessage);

    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
    });

    // ── Drag and drop ─────────────────────────────────────

    document.body.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    document.body.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
            pendingFile = e.dataTransfer.files[0];
            uploadFilename.textContent = pendingFile.name;
            uploadPreview.style.display = "flex";
        }
    });
})();
