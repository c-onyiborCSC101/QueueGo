const APP_NAME = "QueueGo";

const API_BASE =
    window.location.protocol === "file:"
        ? "http://localhost:3000"
        : window.location.origin;

const CONNECTION_ERROR_MESSAGE =
    "We could not connect to QueueGo right now. Check your internet connection and try again in a moment.";

const WAKING_SERVER_MESSAGE =
    "QueueGo is starting up. This can take up to a minute — please wait and try again.";

let confirmModalReady = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFetchErrorMessage(err, response) {
    if (response && (response.status === 502 || response.status === 503 || response.status === 504)) {
        return WAKING_SERVER_MESSAGE;
    }
    if (err && err.message && err.message !== "Failed to fetch") {
        return err.message;
    }
    return CONNECTION_ERROR_MESSAGE;
}

async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
            throw new Error(WAKING_SERVER_MESSAGE);
        }
        throw new Error(CONNECTION_ERROR_MESSAGE);
    }
}

async function fetchWithRetry(url, options = {}, retries = 2) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetch(url, options);
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                await delay(attempt === 0 ? 2000 : 4000);
            }
        }
    }

    throw lastError;
}

async function postJson(path, body, options = {}) {
    const response = await fetchWithRetry(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        body: JSON.stringify(body),
        ...options
    });
    const data = await parseJsonResponse(response);
    return { response, data };
}

function warmUpServer() {
    fetch(`${API_BASE}/health`, { method: "GET" }).catch(() => {});
}

function enhanceSelectField(selectEl, theme) {
    if (!selectEl) return;

    selectEl.classList.add("app-select");

    if (selectEl.closest(".app-select-wrap")) {
        return;
    }

    const wrap = document.createElement("div");
    wrap.className = "app-select-wrap";

    if (theme) {
        wrap.classList.add(`app-select-wrap--${theme}`);
    } else if (document.body.classList.contains("theme-driver")) {
        wrap.classList.add("app-select-wrap--driver");
    } else if (document.body.classList.contains("theme-passenger")) {
        wrap.classList.add("app-select-wrap--passenger");
    } else if (document.body.classList.contains("theme-admin")) {
        wrap.classList.add("app-select-wrap--admin");
    }

    const parent = selectEl.parentNode;
    if (parent) {
        parent.insertBefore(wrap, selectEl);
        wrap.appendChild(selectEl);
    }
}

function initAppSelects(root = document) {
    root.querySelectorAll("select:not(.app-select)").forEach((el) => enhanceSelectField(el));
}

async function fetchDriverList() {
    const response = await fetchWithRetry(`${API_BASE}/drivers`);
    const data = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(data.error || CONNECTION_ERROR_MESSAGE);
    }

    return Array.isArray(data) ? data : [];
}

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
