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
    const e2eModal = document.getElementById("e2eModal");
    const e2eInput = document.getElementById("e2ePassphrase");
    const e2eBtnSet = document.getElementById("e2eBtnSet");
    const e2eStatus = document.getElementById("e2eStatus");
    const e2eBtnChange = document.getElementById("e2eBtnChange");
    const e2eBtnSkip = document.getElementById("e2eBtnSkip");

    let pendingFile = null;
    const messageTimers = {};

    // ── E2E setup ─────────────────────────────────────────

    function initE2E() {
        const restored = E2E.restoreFromSession();
        if (restored) {
            hideModal();
            updateE2EStatus(true);
        } else {
            showModal();
        }
    }

    function showModal() {
        e2eModal.style.display = "flex";
        e2eInput.focus();
    }

    function hideModal() {
        e2eModal.style.display = "none";
    }

    function updateE2EStatus(active) {
        if (active) {
            e2eStatus.textContent = "E2E active";
            e2eStatus.classList.add("active");
            e2eStatus.classList.remove("inactive");
        } else {
            e2eStatus.textContent = "E2E off";
            e2eStatus.classList.add("inactive");
            e2eStatus.classList.remove("active");
        }
    }

    e2eBtnSet.addEventListener("click", () => {
        const passphrase = e2eInput.value.trim();
        if (!passphrase) return;
        E2E.setPassphrase(passphrase);
        hideModal();
        updateE2EStatus(true);
        redecryptAll();
    });

    e2eInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e2eBtnSet.click();
    });

    e2eBtnSkip.addEventListener("click", () => {
        hideModal();
        updateE2EStatus(false);
    });

    e2eBtnChange.addEventListener("click", () => {
        E2E.clear();
        updateE2EStatus(false);
        e2eInput.value = "";
        showModal();
    });

    // ── Skip E2E (optional) ───────────────────────────────
    // Allow closing modal without passphrase by pressing Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && e2eModal.style.display !== "none") {
            hideModal();
            updateE2EStatus(false);
        }
    });

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
        setTimeout(() => {
            if (messagesList.children.length === 0) showEmpty();
        }, 500);
    });

    // ── Render ─────────────────────────────────────────────

    function addMessage(msg) {
        const div = document.createElement("div");
        div.className = "message";
        div.id = `msg-${msg.id}`;

        if (msg._own) {
            div.classList.add("own");
        }

        let displayText = "";
        if (msg.text) {
            displayText = msg.encrypted ? E2E.decryptText(msg.text) : msg.text;
        }

        let html = `<div class="msg-header">
            <span class="msg-user">${escHtml(msg.user)}</span>
            <span class="msg-time">${escHtml(msg.time_str)}</span>
            ${msg.encrypted ? '<span class="msg-e2e-badge">E2E</span>' : ''}
            <span class="msg-ttl" id="ttl-${msg.id}"></span>
        </div>`;

        if (displayText) {
            html += `<div class="msg-text" data-encrypted-text="${msg.encrypted ? escAttr(msg.text) : ''}">${escHtml(displayText)}</div>`;
        }

        if (msg.file_id) {
            const fname = msg.filename || "file";
            if (msg.encrypted) {
                html += `<a class="msg-file" href="#" data-file-id="${escAttr(msg.file_id)}" data-filename="${escAttr(fname)}" onclick="downloadDecryptedFile(this); return false;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    ${escHtml(fname)}
                </a>`;
            } else {
                html += `<a class="msg-file" href="/files/${encodeURIComponent(msg.file_id)}" download="${escAttr(fname)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    ${escHtml(fname)}
                </a>`;
            }
        }

        div.innerHTML = html;
        messagesList.appendChild(div);
        startTtlCountdown(msg);
    }

    function redecryptAll() {
        const textEls = document.querySelectorAll(".msg-text[data-encrypted-text]");
        for (const el of textEls) {
            const ct = el.getAttribute("data-encrypted-text");
            if (ct) {
                el.textContent = E2E.decryptText(ct);
            }
        }
    }

    // Expose for inline onclick on encrypted file links
    window.downloadDecryptedFile = async function(linkEl) {
        if (!E2E.isReady()) {
            alert("Enter the encryption passphrase first");
            return;
        }
        const fileId = linkEl.dataset.fileId;
        const filename = linkEl.dataset.filename;
        const origText = linkEl.textContent;
        linkEl.textContent = "Decrypting...";
        try {
            const resp = await fetch(`/files/${encodeURIComponent(fileId)}`);
            if (!resp.ok) throw new Error(resp.statusText);
            // Server stores the encrypted file as base64 text
            const base64Ciphertext = await resp.text();
            const decryptedBuf = E2E.decryptFileBase64(base64Ciphertext);
            const blob = new Blob([decryptedBuf]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(`Decryption failed: ${e.message}`);
        }
        linkEl.textContent = origText;
    };

    function startTtlCountdown(msg) {
        const expireTime = (msg.ts + msg.ttl) * 1000;
        const ttlEl = () => document.getElementById(`ttl-${msg.id}`);
        const msgEl = () => document.getElementById(`msg-${msg.id}`);

        const update = () => {
            const remaining = Math.max(0, Math.ceil((expireTime - Date.now()) / 1000));
            const el = ttlEl();
            if (el) el.textContent = `${remaining}s`;
            const mel = msgEl();
            if (mel && remaining <= 15) mel.classList.add("expiring");
            if (remaining <= 0) clearMessageTimer(msg.id);
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
            <p style="font-size:0.75rem;">Messages are end-to-end encrypted and self-destruct</p>
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

        const encrypted = E2E.isReady();
        let fileData = {};

        if (pendingFile) {
            try {
                let uploadFilename_str = pendingFile.name;
                let uploadBody;

                if (encrypted) {
                    const buf = await pendingFile.arrayBuffer();
                    const base64Ciphertext = E2E.encryptFileBuffer(buf);
                    uploadBody = new Blob([base64Ciphertext], { type: "application/octet-stream" });
                } else {
                    uploadBody = pendingFile;
                }

                const formData = new FormData();
                formData.append("file", uploadBody, uploadFilename_str);
                const resp = await fetch("/upload", { method: "POST", body: formData });
                if (!resp.ok) {
                    alert(`Upload failed: ${resp.statusText}`);
                    return;
                }
                const data = await resp.json();
                fileData = { file_id: data.file_id, filename: uploadFilename_str };
            } catch (e) {
                alert(`Upload error: ${e.message}`);
                return;
            }
            clearFile();
        }

        let sendText = text;
        if (encrypted && text) {
            sendText = await E2E.encryptText(text);
        }

        socket.emit("send_message", {
            text: sendText,
            encrypted: encrypted,
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

    // ── Init ──────────────────────────────────────────────
    initE2E();
})();
