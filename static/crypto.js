/**
 * End-to-end encryption module using CryptoJS (AES-256).
 * Works on plain HTTP — no secure context required.
 * The server never sees plaintext — only base64-encoded ciphertext.
 */
const E2E = (() => {
    "use strict";

    const STORAGE_KEY = "e2e_passphrase";
    let _passphrase = null;

    // ── Encrypt ───────────────────────────────────────────

    function encryptText(plaintext) {
        if (!_passphrase) throw new Error("No encryption key set");
        return CryptoJS.AES.encrypt(plaintext, _passphrase).toString();
    }

    function encryptFileBuffer(arrayBuffer) {
        if (!_passphrase) throw new Error("No encryption key set");
        const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
        const encrypted = CryptoJS.AES.encrypt(wordArray, _passphrase);
        return encrypted.toString();
    }

    // ── Decrypt ───────────────────────────────────────────

    function decryptText(ciphertext) {
        if (!_passphrase) return "[encrypted - enter passphrase]";
        try {
            const bytes = CryptoJS.AES.decrypt(ciphertext, _passphrase);
            const result = bytes.toString(CryptoJS.enc.Utf8);
            if (!result) return "[decryption failed - wrong passphrase?]";
            return result;
        } catch {
            return "[decryption failed - wrong passphrase?]";
        }
    }

    function decryptFileBase64(base64Ciphertext) {
        if (!_passphrase) throw new Error("No encryption key set");
        const decrypted = CryptoJS.AES.decrypt(base64Ciphertext, _passphrase);
        // Convert WordArray to Uint8Array
        const words = decrypted.words;
        const sigBytes = decrypted.sigBytes;
        const bytes = new Uint8Array(sigBytes);
        for (let i = 0; i < sigBytes; i++) {
            bytes[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        }
        return bytes.buffer;
    }

    // ── Key management ────────────────────────────────────

    function setPassphrase(passphrase) {
        _passphrase = passphrase;
        sessionStorage.setItem(STORAGE_KEY, passphrase);
    }

    function getPassphrase() {
        return _passphrase;
    }

    function isReady() {
        return _passphrase !== null;
    }

    function restoreFromSession() {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
            _passphrase = saved;
            return true;
        }
        return false;
    }

    function clear() {
        _passphrase = null;
        sessionStorage.removeItem(STORAGE_KEY);
    }

    return {
        setPassphrase,
        getPassphrase,
        isReady,
        restoreFromSession,
        clear,
        encryptText,
        encryptFileBuffer,
        decryptText,
        decryptFileBase64,
    };
})();
