const loginPanel = document.getElementById("loginPanel");
const dashboardPanel = document.getElementById("dashboardPanel");
const adminLoginForm = document.getElementById("adminLoginForm");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");
const driverForm = document.getElementById("driverForm");
const staffForm = document.getElementById("staffForm");
const driverOnboardingCard = document.getElementById("driverOnboardingCard");
const smsStatusBanner = document.getElementById("smsStatusBanner");
const adminSetupHint = document.getElementById("adminSetupHint");
const adminRegisterLink = document.getElementById("adminRegisterLink");
const waitingList = document.getElementById("waitingList");
const activeList = document.getElementById("activeList");
const queueList = document.getElementById("queueList");
const driverList = document.getElementById("driverList");

const STATUS_LABEL = {
    waiting: "WAITING FOR DRIVER",
    assigned: "DRIVER ASSIGNED",
    in_progress: "IN PROGRESS",
    arriving: "IN PROGRESS",
    accepted: "IN PROGRESS",
    completed: "RIDE COMPLETED",
    rejected: "RIDE REJECTED"
};

let fallbackPollTimer = null;

loadAdminSetupHint();
applyLoginQueryParams();

adminLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value;

    try {
        const { response, data } = await postJson("/auth/admin/login", { email, password });

        if (!response.ok || data.error) {
            setLoginMessage(data.error || "Login failed.", true);
            return;
        }

        sessionStorage.setItem("kekeAdminToken", data.token);
        showDashboard();
        setMessage("Signed in. Live updates enabled.");
    } catch (err) {
        setLoginMessage(getFetchErrorMessage(err), true);
    }
});

async function loadAdminSetupHint() {
    if (!adminSetupHint) return;

    try {
        const response = await fetch(`${API_BASE}/auth/admin/setup-status`);
        const data = await response.json();
        if (!response.ok) return;

        if (!data.hasAdmins) {
            adminSetupHint.textContent =
                "First time here? Use “Create staff account” to set up the initial operations login.";
            return;
        }

        if (data.inviteConfigured) {
            adminSetupHint.textContent =
                "New team member? Register with the staff invite code from your lead.";
            return;
        }

        adminSetupHint.textContent =
            "New staff are added by an existing admin from the control room after sign-in.";
        if (adminRegisterLink) {
            adminRegisterLink.textContent = "Staff registration (invite required)";
        }
    } catch (err) {
        adminSetupHint.textContent = "";
    }
}

function applyLoginQueryParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") {
        const email = params.get("email");
        if (email && document.getElementById("adminEmail")) {
            document.getElementById("adminEmail").value = email;
        }
        setLoginMessage("Account created. Sign in with your new credentials.", false);
        window.history.replaceState({}, "", "/staff");
    }
}

adminLogoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("kekeAdminToken");
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    showLogin();
    setMessage("Logged out.");
});

driverForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("driverName").value.trim();
    const phone = document.getElementById("driverPhone").value.trim();
    const pin = document.getElementById("driverPin").value.trim() || "1234";

    try {
        const response = await authFetch("/driver", {
            method: "POST",
            body: JSON.stringify({ name, phone, pin })
        });
        const data = await response.json();

        if (!response.ok || data.error) {
            setMessage(data.error || "Could not register driver.");
            return;
        }

        setMessage(data.message);
        showDriverOnboarding({
            name,
            phone,
            pin: data.pin || pin,
            portalUrl: data.portalUrl,
            smsSent: data.smsSent,
            smsMode: data.smsMode,
            smsError: data.smsError
        });
        driverForm.reset();
        refreshDashboard();
    } catch (err) {
        setMessage("Could not register driver.");
    }
});

staffForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("staffName").value.trim();
    const email = document.getElementById("staffEmail").value.trim();
    const password = document.getElementById("staffPassword").value;

    try {
        const response = await authFetch("/admin/staff", {
            method: "POST",
            body: JSON.stringify({ name, email, password })
        });
        const data = await response.json();

        if (!response.ok || data.error) {
            setMessage(data.error || "Could not add staff member.");
            return;
        }

        setMessage(`Staff account created for ${data.admin.email}. Share their login details securely.`);
        staffForm.reset();
    } catch (err) {
        setMessage("Could not add staff member.");
    }
});

function showDriverOnboarding({ name, phone, pin, portalUrl, smsSent, smsMode, smsError }) {
    if (!driverOnboardingCard) return;

    const smsNote = smsSent && smsMode === "termii"
        ? "An SMS with the sign-in link and PIN was sent to their phone."
        : smsSent && smsMode === "console"
            ? "SMS is in demo mode — check the server terminal for the PIN text (not sent to a real phone). Share the details below with the driver."
            : smsError
              ? `SMS failed: ${smsError}. Share the details below with the driver directly.`
              : "No SMS was sent — share the details below with the driver directly.";

    driverOnboardingCard.hidden = false;
    driverOnboardingCard.innerHTML = `
        <h3>Share with ${escapeHtml(name)}</h3>
        <p class="onboarding-note">${escapeHtml(smsNote)}</p>
        <dl class="onboarding-details">
            <dt>Driver portal</dt>
            <dd><a href="${escapeHtml(portalUrl)}" target="_blank" rel="noopener">${escapeHtml(portalUrl)}</a></dd>
            <dt>Name on list</dt>
            <dd>${escapeHtml(name)}</dd>
            <dt>PIN</dt>
            <dd><code>${escapeHtml(pin)}</code></dd>
            <dt>Phone on file</dt>
            <dd>${escapeHtml(phone)}</dd>
        </dl>
        <p class="onboarding-note">They select their name, enter the PIN, and stay signed in to receive jobs.</p>
    `;
}

function setupSocket() {
    const s = connectSocket();
    if (!s) return;

    s.on("rides:updated", () => {
        if (getAdminToken()) refreshDashboard();
    });
}

function showLogin() {
    document.body.classList.remove("dashboard-mode");
    loginPanel.hidden = false;
    loginPanel.removeAttribute("aria-hidden");
    dashboardPanel.hidden = true;
    dashboardPanel.setAttribute("aria-hidden", "true");
}

function showDashboard() {
    document.body.classList.add("dashboard-mode");
    loginPanel.hidden = true;
    loginPanel.setAttribute("aria-hidden", "true");
    dashboardPanel.hidden = false;
    dashboardPanel.removeAttribute("aria-hidden");
    joinAdminRoom();
    setupSocket();
    refreshDashboard();
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    fallbackPollTimer = setInterval(refreshDashboard, 30000);
}

async function loadSmsStatus() {
    if (!smsStatusBanner) return;

    try {
        const response = await authFetch("/admin/sms/status");
        const data = await response.json();
        if (!response.ok) return;

        if (data.provider === "termii" && data.termiiConfigured) {
            smsStatusBanner.hidden = false;
            smsStatusBanner.innerHTML = `
                <h3>Live SMS (Termii)</h3>
                <p class="onboarding-note">Driver PINs and ride alerts are sent by SMS. Drivers can reply <strong>1</strong> to accept or <strong>0</strong> to reject.</p>
                <p class="onboarding-note">Inbound webhook (set in <a href="https://accounts.termii.com" target="_blank" rel="noopener">Termii dashboard</a>):<br><code>${escapeHtml(data.inboundWebhookUrl || "/webhooks/sms/inbound")}</code></p>
            `;
            return;
        }

        if (data.provider === "console") {
            smsStatusBanner.hidden = false;
            smsStatusBanner.innerHTML = `
                <h3>SMS demo mode</h3>
                <p class="onboarding-note">Messages print in the server logs only. Set <code>SMS_PROVIDER=termii</code> on Render for real texts — see <code>SMS_SETUP.md</code>.</p>
            `;
            return;
        }

        smsStatusBanner.hidden = true;
    } catch {
        smsStatusBanner.hidden = true;
    }
}

async function refreshDashboard() {
    if (!getAdminToken()) return;

    try {
        await Promise.all([
            loadStats(),
            loadQueue(),
            loadDrivers(),
            loadHistory(),
            loadSmsStatus()
        ]);
    } catch (err) {
        console.error(err);
    }
}

async function loadStats() {
    const response = await authFetch("/dashboard-stats");
    const stats = await response.json();

    if (!response.ok) return;

    document.getElementById("statWaiting").textContent = stats.waiting || 0;
    document.getElementById("statAssigned").textContent =
        (stats.assigned || 0) +
        (stats.in_progress || 0) +
        (stats.arriving || 0) +
        (stats.accepted || 0);
    document.getElementById("statCompleted").textContent = stats.completed || 0;
    document.getElementById("statAvailable").textContent = stats.availableDrivers || 0;
    document.getElementById("statBusy").textContent = stats.busyDrivers || 0;
}

async function loadQueue() {
    const response = await authFetch("/queue");
    const queue = await response.json();

    if (!Array.isArray(queue)) return;

    const waiting = queue.filter((r) => r.status === "waiting");
    const active = queue.filter((r) =>
        ["assigned", "in_progress", "arriving", "accepted"].includes(r.status)
    );

    waitingList.innerHTML = waiting.length
        ? waiting.map((p) => renderPassengerCard(p, true)).join("")
        : "<p class='empty-note'>No passengers waiting.</p>";

    activeList.innerHTML = active.length
        ? active.map((p) => renderPassengerCard(p, true)).join("")
        : "<p class='empty-note'>No active rides right now.</p>";

    queueList.innerHTML = queue.length
        ? queue.map((p) => renderPassengerCard(p, true)).join("")
        : "<p class='empty-note'>Queue is empty.</p>";
}

async function loadHistory() {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;

    const response = await authFetch("/rides/history");
    const history = await response.json();

    historyList.innerHTML = history.length
        ? history.map((p) => renderPassengerCard(p, false)).join("")
        : "<p class='empty-note'>No completed or rejected rides yet.</p>";
}

async function loadDrivers() {
    const response = await fetch(`${API_BASE}/drivers`);
    const drivers = await response.json();

    if (!Array.isArray(drivers)) return;

    const countBadge = document.getElementById("driverCountBadge");
    if (countBadge) {
        countBadge.textContent = `${drivers.length} driver${drivers.length === 1 ? "" : "s"}`;
    }

    driverList.innerHTML = drivers.length
        ? drivers.map(renderDriverCard).join("")
        : "<p class='empty-note'>No drivers registered yet. Add one using the form below.</p>";
}

function renderPassengerCard(passenger, showActions) {
    const status = passenger.status || "waiting";
    const label = STATUS_LABEL[status] || status.toUpperCase();
    const driverLine = passenger.driver_name
        ? `<br><strong>Driver:</strong> ${escapeHtml(passenger.driver_name)} (${escapeHtml(passenger.driver_phone || "—")})`
        : "";

    const actions = showActions ? renderAdminActions(passenger) : "";

    return `
        <div class="card card-status-${status}">
            <strong>#${passenger.id}</strong> — ${escapeHtml(passenger.name)}<br>
            <strong>Pickup:</strong> ${escapeHtml(passenger.location)}<br>
            <strong>Destination:</strong> ${escapeHtml(passenger.destination || "—")}<br>
            <strong>Destination:</strong> ${escapeHtml(passenger.destination || "—")}<br>
            <strong>Status:</strong> ${label}${driverLine}
            ${actions}
        </div>
    `;
}

function renderAdminActions(passenger) {
    const status = passenger.status || "waiting";

    if (["completed", "rejected"].includes(status)) {
        return "";
    }

    if (status === "waiting") {
        return "<p class='empty-note' style='margin:10px 0 0;font-style:normal'>Auto-dispatch will assign the next available driver.</p>";
    }

    if (status === "assigned") {
        return `
        <div class="card-actions">
            <p class='empty-note' style='margin:0 0 8px;font-style:normal'>Driver must accept in the app or via SMS — status becomes in progress automatically.</p>
            <button class="btn-reassign" data-action="reassign" data-id="${passenger.id}">Reassign Driver</button>
        </div>`;
    }

    return `
        <div class="card-actions">
            <button class="btn-complete" data-action="complete" data-id="${passenger.id}">Override: Complete</button>
            <button class="btn-reject" data-action="reject" data-id="${passenger.id}">Override: Reject</button>
            <button class="btn-reassign" data-action="reassign" data-id="${passenger.id}">Reassign Driver</button>
        </div>`;
}

function renderDriverCard(driver) {
    const isAvailable = driver.status === "available";
    const statusClass = isAvailable ? "driver-available" : "driver-busy";
    const statusLabel = isAvailable ? "Available" : "Busy";

    return `
        <div class="fleet-card ${statusClass}">
            <div class="fleet-card-main">
                <div class="fleet-card-title">
                    <strong>${escapeHtml(driver.name)}</strong>
                    <span class="fleet-status-chip ${isAvailable ? "fleet-status-chip--available" : "fleet-status-chip--busy"}">${statusLabel}</span>
                </div>
                <p class="fleet-card-meta"><span>ID #${driver.id}</span> · <span>${escapeHtml(driver.phone || "—")}</span></p>
            </div>
            <button type="button" class="btn-remove-driver" data-action="delete-driver" data-id="${driver.id}" data-name="${escapeHtml(driver.name)}">
                Remove
            </button>
        </div>
    `;
}

dashboardPanel.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === "delete-driver") {
        const driverName = btn.dataset.name || "this driver";
        const confirmed = await showAppConfirm({
            eyebrow: "Fleet management",
            title: `Remove ${driverName}?`,
            message:
                "Any active rides for this driver will return to the waiting queue. They will no longer appear on the driver sign-in list.",
            confirmLabel: "Remove driver",
            cancelLabel: "Keep driver",
            danger: true
        });
        if (!confirmed) return;

        btn.disabled = true;

        try {
            const response = await authFetch(`/driver/${id}`, { method: "DELETE" });
            const data = await response.json();
            if (!response.ok || data.error) {
                setMessage(data.error || "Could not remove driver.", true);
                return;
            }
            setMessage(data.message || "Driver removed.");
            await refreshDashboard();
        } catch (err) {
            setMessage("Could not remove driver.", true);
        } finally {
            btn.disabled = false;
        }
        return;
    }

    const endpoints = {
        complete: `/complete/${id}`,
        reject: `/reject/${id}`,
        reassign: `/reassign/${id}`,
        arriving: `/arriving/${id}`
    };

    try {
        const response = await authFetch(endpoints[action], { method: "POST" });
        const data = await response.json();
        setMessage(data.message || data.error || "Action completed.");
        refreshDashboard();
    } catch (err) {
        setMessage("Action failed.");
    }
});

function setMessage(text, isError) {
    const el = document.getElementById("adminMessage");
    if (el) {
        el.textContent = text;
        el.style.color = isError ? "#b91c1c" : "#0369a1";
    }
}

function setLoginMessage(text, isError) {
    const el = document.getElementById("loginMessage");
    if (el) {
        el.textContent = text;
        el.style.color = isError ? "#c62828" : "#0369a1";
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

if (getAdminToken()) {
    showDashboard();
} else {
    showLogin();
}
