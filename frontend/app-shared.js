const APP_NAME = "QueueGo";

const API_BASE =
    window.location.protocol === "file:"
        ? "http://localhost:3000"
        : window.location.origin;

let confirmModalReady = false;

function ensureConfirmModal() {
    if (confirmModalReady) return;

    const root = document.createElement("div");
    root.id = "appConfirmModal";
    root.className = "app-modal";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
        <div class="app-modal-backdrop" data-confirm-dismiss></div>
        <div class="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle">
            <div class="app-modal-header">
                <span class="app-modal-brand">🛺 ${APP_NAME}</span>
                <p class="app-modal-eyebrow" id="appConfirmEyebrow">Confirm action</p>
                <h2 class="app-modal-title" id="appConfirmTitle"></h2>
            </div>
            <p class="app-modal-body" id="appConfirmBody"></p>
            <div class="app-modal-actions">
                <button type="button" class="btn-secondary btn-secondary--sm" id="appConfirmCancel">Cancel</button>
                <button type="button" class="btn-primary" id="appConfirmOk">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(root);
    confirmModalReady = true;
}

function showAppConfirm({
    title,
    message,
    eyebrow = "Confirm action",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false
}) {
    ensureConfirmModal();

    const modal = document.getElementById("appConfirmModal");
    const titleEl = document.getElementById("appConfirmTitle");
    const bodyEl = document.getElementById("appConfirmBody");
    const eyebrowEl = document.getElementById("appConfirmEyebrow");
    const okBtn = document.getElementById("appConfirmOk");
    const cancelBtn = document.getElementById("appConfirmCancel");
    const card = modal.querySelector(".app-modal-card");

    titleEl.textContent = title;
    bodyEl.textContent = message;
    eyebrowEl.textContent = eyebrow;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    card.classList.toggle("app-modal-card--danger", danger);
    okBtn.classList.toggle("btn-modal-danger", danger);

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    return new Promise((resolve) => {
        const close = (result) => {
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
            document.body.classList.remove("modal-open");
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            modal.querySelectorAll("[data-confirm-dismiss]").forEach((el) => {
                el.removeEventListener("click", onCancel);
            });
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };

        const onOk = () => close(true);
        const onCancel = () => close(false);
        const onKey = (e) => {
            if (e.key === "Escape") onCancel();
        };

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        modal.querySelectorAll("[data-confirm-dismiss]").forEach((el) => {
            el.addEventListener("click", onCancel);
        });
        document.addEventListener("keydown", onKey);
        cancelBtn.focus();
    });
}

function getAdminToken() {
    return sessionStorage.getItem("kekeAdminToken");
}

function getDriverToken() {
    return sessionStorage.getItem("kekeDriverToken");
}

function getPassengerToken() {
    return sessionStorage.getItem("kekePassengerToken");
}

function authFetch(url, options = {}, role = "admin") {
    let token = getAdminToken();

    if (role === "driver") {
        token = getDriverToken();
    } else if (role === "passenger") {
        token = getPassengerToken();
    }

    const headers = { ...(options.headers || {}) };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    return fetch(`${API_BASE}${url}`, { ...options, headers });
}

let socket = null;

function connectSocket() {
    if (typeof io === "undefined") {
        return null;
    }
    if (!socket) {
        socket = io(API_BASE);
    }
    return socket;
}

function joinRideRoom(requestId) {
    const s = connectSocket();
    if (s && requestId) {
        s.emit("join:ride", requestId);
    }
}

function joinDriverRoom(driverId) {
    const s = connectSocket();
    if (s && driverId) {
        s.emit("join:driver", driverId);
    }
}

function joinAdminRoom() {
    const s = connectSocket();
    if (s) {
        s.emit("join:admin");
    }
}
