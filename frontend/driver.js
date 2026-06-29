const driverSelect = document.getElementById("driverSelect");
const driverPin = document.getElementById("driverPin");
const driverLoginBtn = document.getElementById("driverLoginBtn");
const driverLogoutBtn = document.getElementById("driverLogoutBtn");
const refreshDriversBtn = document.getElementById("refreshDriversBtn");
const driverSelectHint = document.getElementById("driverSelectHint");
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
let driverListPollTimer = null;
let currentDriverId = null;
let currentBatch = null;

enhanceSelectField(driverSelect, "driver");
warmUpServer();
loadDrivers();
setupSocket();
startDriverListPoll();

driverLoginBtn.addEventListener("click", loginDriver);
driverLogoutBtn.addEventListener("click", logoutDriver);
if (refreshDriversBtn) {
    refreshDriversBtn.addEventListener("click", () => loadDrivers(true));
}

function setupSocket() {
    const s = connectSocket();
    if (!s) return;

    s.off("driver:updated");
    s.off("rides:updated");
    s.off("drivers:updated");

    s.on("driver:updated", () => {
        if (currentDriverId && getDriverToken()) {
            refreshDriverView();
        } else {
            loadDrivers();
        }
    });

    s.on("rides:updated", () => {
        if (currentDriverId && getDriverToken()) {
            refreshDriverView();
        } else {
            loadDrivers();
        }
    });

    s.on("drivers:updated", () => {
        if (!currentDriverId || !getDriverToken()) {
            loadDrivers();
        }
    });
}

function formatDriverStatus(status) {
    if (status === "available") return "Available";
    if (status === "busy") return "On a ride";
    return String(status || "registered").replace(/_/g, " ");
}

function populateDriverSelect(drivers, selectedId) {
    if (!driverSelect) return;

    const keepId = selectedId || driverSelect.value;
    driverSelect.innerHTML = '<option value="">— Select your name —</option>';

    drivers.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = String(d.id);
        opt.textContent = `${d.name} · ${formatDriverStatus(d.status)}`;
        driverSelect.appendChild(opt);
    });

    if (keepId && drivers.some((d) => String(d.id) === String(keepId))) {
        driverSelect.value = String(keepId);
    }

    if (driverSelectHint) {
        if (!drivers.length) {
            driverSelectHint.hidden = false;
            driverSelectHint.textContent =
                "No drivers listed yet. Ask campus operations to register you, then tap Refresh list.";
        } else {
            driverSelectHint.hidden = true;
            driverSelectHint.textContent = "";
        }
    }
}

async function loadDrivers(manualRefresh = false) {
    if (refreshDriversBtn && manualRefresh) {
        refreshDriversBtn.disabled = true;
        refreshDriversBtn.textContent = "Refreshing…";
    }

    try {
        const drivers = await fetchDriverList();
        populateDriverSelect(drivers, driverSelect ? driverSelect.value : null);

        if (manualRefresh && drivers.length) {
            setMessage("Driver list updated.");
        }

        if (getDriverToken()) {
            const savedId = sessionStorage.getItem("kekeDriverId");
            if (savedId) {
                currentDriverId = Number(savedId);
                if (driverSelect) driverSelect.value = savedId;
                showDriverApp();
                setupSocket();
                joinDriverRoom(currentDriverId);
                refreshDriverView();
                startFallbackPoll();
                stopDriverListPoll();
            }
        }
    } catch (err) {
        if (driverSelectHint) {
            driverSelectHint.hidden = false;
            driverSelectHint.textContent = getFetchErrorMessage(err);
        }
        setMessage(getFetchErrorMessage(err));
    } finally {
        if (refreshDriversBtn) {
            refreshDriversBtn.disabled = false;
            refreshDriversBtn.textContent = "Refresh list";
        }
    }
}

function startDriverListPoll() {
    if (driverListPollTimer) return;
    driverListPollTimer = setInterval(() => {
        if (!currentDriverId && !getDriverToken()) {
            loadDrivers();
        }
    }, 12000);
}

function stopDriverListPoll() {
    if (driverListPollTimer) {
        clearInterval(driverListPollTimer);
        driverListPollTimer = null;
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
        const { response, data } = await postJson("/auth/driver/login", {
            driverId: Number(driverId),
            pin
        });

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
        stopDriverListPoll();
    } catch (err) {
        setMessage(getFetchErrorMessage(err));
    }
}

function logoutDriver() {
    sessionStorage.removeItem("kekeDriverToken");
    sessionStorage.removeItem("kekeDriverId");
    currentDriverId = null;
    currentBatch = null;
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    const lastDriverId = driverSelect ? driverSelect.value : "";
    showLoginOnly();
    loadDrivers();
    startDriverListPoll();
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
        const [drivers, batchRes] = await Promise.all([
            fetchDriverList(),
            authFetch(`/driver/${currentDriverId}/batch`, {}, "driver")
        ]);

        const batch = await parseJsonResponse(batchRes);
        const me = drivers.find((d) => Number(d.id) === Number(currentDriverId));

        if (me) {
            if (driverDisplayName) driverDisplayName.textContent = me.name;
            driverStatusLine.textContent = `${formatDriverStatus(me.status).toUpperCase()} · ${me.phone}`;
        }

        currentBatch = batch;
        if (batch && batch.stops && batch.stops.length) {
            showBatch(batch);
        } else {
            showNoBatch();
        }
    } catch (err) {
        setMessage(getFetchErrorMessage(err));
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
        const data = await parseJsonResponse(response);

        if (!response.ok || data.error) {
            setMessage(data.error || "Action failed.");
            return;
        }

        setMessage(data.message || "Done.");
        await refreshDriverView();
    } catch (err) {
        setMessage(getFetchErrorMessage(err));
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
