const driverSelect = document.getElementById("driverSelect");
const driverPin = document.getElementById("driverPin");
const driverLoginBtn = document.getElementById("driverLoginBtn");
const driverLogoutBtn = document.getElementById("driverLogoutBtn");
const driverAuthMain = document.getElementById("driverAuthMain");
const driverLoginSection = document.getElementById("driverLoginSection");
const driverAppSection = document.getElementById("driverAppSection");
const driverDisplayName = document.getElementById("driverDisplayName");
const driverStatusLine = document.getElementById("driverStatusLine");
const driverMessage = document.getElementById("driverMessage");
const driverBatchCard = document.getElementById("driverBatchCard");
const batchStopList = document.getElementById("batchStopList");
const batchCountBadge = document.getElementById("batchCountBadge");
const noRideCard = document.getElementById("noRideCard");

let fallbackPollTimer = null;
let currentDriverId = null;
let currentBatch = null;

loadDrivers();
setupSocket();
driverLoginBtn.addEventListener("click", loginDriver);
driverLogoutBtn.addEventListener("click", logoutDriver);

function setupSocket() {
    const s = connectSocket();
    if (!s) return;

    s.off("driver:updated");
    s.off("rides:updated");

    s.on("driver:updated", () => {
        if (currentDriverId && getDriverToken()) {
            refreshDriverView();
        } else {
            refreshDriverSelect();
        }
    });

    s.on("rides:updated", () => {
        if (currentDriverId && getDriverToken()) {
            refreshDriverView();
        } else {
            refreshDriverSelect();
        }
    });
}

function populateDriverSelect(drivers, selectedId) {
    const keepId = selectedId || driverSelect.value;
    driverSelect.innerHTML = '<option value="">— Choose driver —</option>';
    drivers.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.status})`;
        driverSelect.appendChild(opt);
    });
    if (keepId) {
        driverSelect.value = String(keepId);
    }
}

async function refreshDriverSelect(selectedId) {
    try {
        const response = await fetch(`${API_BASE}/drivers`);
        const drivers = await response.json();
        if (!Array.isArray(drivers)) return;
        populateDriverSelect(drivers, selectedId);
    } catch (err) {
        console.warn("Could not refresh driver list:", err);
    }
}

async function loadDrivers() {
    try {
        const response = await fetch(`${API_BASE}/drivers`);
        const drivers = await response.json();
        populateDriverSelect(drivers);

        if (getDriverToken()) {
            const savedId = sessionStorage.getItem("kekeDriverId");
            if (savedId) {
                currentDriverId = Number(savedId);
                driverSelect.value = savedId;
                showDriverApp();
                setupSocket();
                joinDriverRoom(currentDriverId);
                refreshDriverView();
                startFallbackPoll();
            }
        }
    } catch (err) {
        setMessage("Cannot load drivers. Is the server running?");
    }
}

async function loginDriver() {
    const driverId = driverSelect.value;
    const pin = driverPin.value.trim();

    if (!driverId || !pin) {
        setMessage("Select your profile and enter your PIN.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/auth/driver/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverId: Number(driverId), pin })
        });
        const data = await response.json();

        if (!response.ok || data.error) {
            setMessage(data.error || "Login failed.");
            return;
        }

        sessionStorage.setItem("kekeDriverToken", data.token);
        sessionStorage.setItem("kekeDriverId", String(data.driverId));
        currentDriverId = data.driverId;
        if (driverDisplayName) driverDisplayName.textContent = data.name;
        setMessage(`Welcome back, ${data.name}.`);
        showDriverApp();
        setupSocket();
        joinDriverRoom(currentDriverId);
        refreshDriverView();
        startFallbackPoll();
    } catch (err) {
        setMessage("Login failed. Check server connection.");
    }
}

function logoutDriver() {
    sessionStorage.removeItem("kekeDriverToken");
    sessionStorage.removeItem("kekeDriverId");
    currentDriverId = null;
    currentBatch = null;
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    const lastDriverId = driverSelect.value;
    showLoginOnly();
    refreshDriverSelect(lastDriverId);
    setMessage("Logged out.");
}

function showDriverApp() {
    document.body.classList.add("app-mode");
    if (driverAuthMain) driverAuthMain.hidden = true;
    if (driverLoginSection) driverLoginSection.hidden = true;
    driverAppSection.hidden = false;
}

function showLoginOnly() {
    document.body.classList.remove("app-mode");
    if (driverAuthMain) driverAuthMain.hidden = false;
    if (driverLoginSection) driverLoginSection.hidden = false;
    driverAppSection.hidden = true;
    showNoBatch();
}

function startFallbackPoll() {
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    fallbackPollTimer = setInterval(refreshDriverView, 15000);
}

async function refreshDriverView() {
    if (!currentDriverId || !getDriverToken()) return;

    try {
        const [driversRes, batchRes] = await Promise.all([
            fetch(`${API_BASE}/drivers`),
            authFetch(`/driver/${currentDriverId}/batch`, {}, "driver")
        ]);

        const drivers = await driversRes.json();
        const batch = await batchRes.json();
        const me = drivers.find((d) => d.id === currentDriverId);

        if (me) {
            if (driverDisplayName) driverDisplayName.textContent = me.name;
            driverStatusLine.textContent = `${me.status.toUpperCase()} · ${me.phone}`;
        }

        currentBatch = batch;
        if (batch && batch.stops && batch.stops.length) {
            showBatch(batch);
        } else {
            showNoBatch();
        }
    } catch (err) {
        setMessage("Connection error. Retrying...");
    }
}

function showBatch(batch) {
    noRideCard.hidden = true;
    driverBatchCard.hidden = false;

    const count = batch.batchSize || batch.stops.length;
    batchCountBadge.textContent = `${count} passenger${count === 1 ? "" : "s"}`;

    batchStopList.innerHTML = batch.stops
        .map((stop) => renderBatchStop(stop))
        .join("");

    batchStopList.querySelectorAll("[data-batch-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.batchAction;
            const requestId = Number(btn.dataset.requestId);
            driverBatchAction(action, requestId);
        });
    });
}

function renderBatchStop(stop) {
    const isPickup = stop.stopType === "pickup";
    const action = isPickup ? "pickup" : "dropoff";
    const actionLabel = isPickup ? "Picked up" : "Dropped off";
    const routeLabel = isPickup
        ? `Pick up at <strong>${escapeHtml(stop.pickup)}</strong>`
        : `Drop at <strong>${escapeHtml(stop.destination)}</strong>`;
    const meta = isPickup
        ? `Going to ${escapeHtml(stop.destination)}`
        : `Picked up from ${escapeHtml(stop.pickup)}`;

    return `
        <article class="driver-batch-stop driver-batch-stop--${stop.stopType}">
            <div class="driver-batch-stop-head">
                <span class="driver-batch-stop-order">${stop.stopOrder}</span>
                <div>
                    <p class="driver-batch-stop-type">${isPickup ? "Pickup" : "Drop-off"}</p>
                    <p class="driver-batch-stop-passenger">${escapeHtml(stop.passengerName)}</p>
                </div>
            </div>
            <p class="driver-batch-stop-route">${routeLabel}</p>
            <p class="driver-batch-stop-meta">${meta}</p>
            <div class="driver-batch-stop-actions">
                <button type="button" class="driver-action-btn btn-complete" data-batch-action="${action}" data-request-id="${stop.requestId}">
                    ${actionLabel}
                </button>
                ${isPickup ? `<button type="button" class="driver-action-btn btn-reject" data-batch-action="reject" data-request-id="${stop.requestId}">Remove</button>` : ""}
            </div>
        </article>
    `;
}

function showNoBatch() {
    currentBatch = null;
    driverBatchCard.hidden = true;
    noRideCard.hidden = false;
    if (batchStopList) batchStopList.innerHTML = "";
}

async function driverBatchAction(action, requestId) {
    if (!currentDriverId || !requestId) return;

    const path =
        action === "pickup" ? "pickup" : action === "dropoff" ? "dropoff" : "reject";

    try {
        const response = await authFetch(
            `/driver/${currentDriverId}/${path}/${requestId}`,
            { method: "POST" },
            "driver"
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            setMessage(data.error || "Action failed.");
            return;
        }

        setMessage(data.message || "Done.");
        await refreshDriverView();
    } catch (err) {
        setMessage("Action failed. Check connection.");
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

function setMessage(text) {
    if (!driverMessage) return;
    driverMessage.textContent = text;
    driverMessage.hidden = !text;
}
