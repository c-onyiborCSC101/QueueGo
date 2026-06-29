const passengerAuthMain = document.getElementById("passengerAuthMain");
const appSection = document.getElementById("appSection");
const noRideHint = document.getElementById("noRideHint");
const loginForm = document.getElementById("loginForm");
const authMessage = document.getElementById("authMessage");
const logoutBtn = document.getElementById("logoutBtn");
const welcomeName = document.getElementById("welcomeName");
const welcomeEmail = document.getElementById("welcomeEmail");
const form = document.getElementById("rideForm");
const statusMessage = document.getElementById("statusMessage");
const rideStatusCard = document.getElementById("rideStatusCard");
const statusTitle = document.getElementById("statusTitle");
const statusHint = document.getElementById("statusHint");
const statusName = document.getElementById("statusName");
const statusLocation = document.getElementById("statusLocation");
const statusDestination = document.getElementById("statusDestination");
const statusValue = document.getElementById("statusValue");
const driverInfoBlock = document.getElementById("driverInfoBlock");
const statusDriverName = document.getElementById("statusDriverName");
const statusDriverPhone = document.getElementById("statusDriverPhone");
const rideHistory = document.getElementById("rideHistory");

let currentPassenger = null;
let fallbackPollTimer = null;
let activeRide = null;

const STATUS_CLASS = {
    waiting: "status-waiting",
    assigned: "status-assigned",
    in_progress: "status-arriving",
    arriving: "status-arriving",
    accepted: "status-arriving",
    completed: "status-completed",
    rejected: "status-rejected"
};

const STATUS_COLOR = {
    waiting: "orange",
    assigned: "blue",
    in_progress: "green",
    arriving: "green",
    accepted: "green",
    completed: "#555",
    rejected: "red"
};

const STATUS_LABEL = {
    waiting: "WAITING FOR DRIVER",
    assigned: "DRIVER ASSIGNED",
    in_progress: "ON THE WAY TO YOUR DESTINATION",
    arriving: "ON THE WAY TO YOUR DESTINATION",
    accepted: "ON THE WAY TO YOUR DESTINATION",
    completed: "RIDE COMPLETED",
    rejected: "RIDE REJECTED"
};

fillCampusLocationSelect(document.getElementById("location"), "— Select pickup location —");
fillCampusLocationSelect(document.getElementById("destination"), "— Select destination —");

warmUpServer();

if (loginForm) {
    loginForm.addEventListener("submit", onLogin);
}
if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
}
if (form) {
    form.addEventListener("submit", onSubmit);
}

showRegistrationSuccessFromUrl();

function showRegistrationSuccessFromUrl() {
    const params = new URLSearchParams(window.location.search);

    if (params.get("registered") !== "1") {
        return;
    }

    const email = params.get("email");
    setAuthMessage(
        email
            ? `Account created for ${email}. Log in below to start booking rides.`
            : "Account created successfully. Log in below.",
        false
    );

    if (email && document.getElementById("loginEmail")) {
        document.getElementById("loginEmail").value = email;
        document.getElementById("loginPassword").focus();
    }

    window.history.replaceState({}, "", "/passenger");
}

function setAuthMessage(text, isError) {
    if (!authMessage) return;
    authMessage.textContent = text;
    authMessage.style.color = isError ? "#c62828" : "#2e7d32";
}

async function onLogin(e) {
    e.preventDefault();

    const loginBtn = loginForm.querySelector('button[type="submit"]');
    loginBtn.disabled = true;
    loginBtn.textContent = "Logging in...";
    setAuthMessage("");

    try {
        const { response, data } = await postJson("/auth/passenger/login", {
            email: document.getElementById("loginEmail").value.trim(),
            password: document.getElementById("loginPassword").value
        });

        if (!response.ok || data.error) {
            setAuthMessage(data.error || "Login failed.", true);
            loginBtn.disabled = false;
            loginBtn.textContent = "Log in";
            return;
        }

        startSession(data.passenger, data.token);
    } catch (err) {
        setAuthMessage(getFetchErrorMessage(err), true);
        loginBtn.disabled = false;
        loginBtn.textContent = "Log in";
    }
}

function startSession(passenger, token) {
    sessionStorage.setItem("kekePassengerToken", token);
    sessionStorage.setItem("kekePassenger", JSON.stringify(passenger));
    currentPassenger = passenger;
    showApp();
}

function logout() {
    sessionStorage.removeItem("kekePassengerToken");
    sessionStorage.removeItem("kekePassenger");
    sessionStorage.removeItem("kekeActiveRide");
    currentPassenger = null;
    activeRide = null;
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    document.body.classList.remove("app-mode");
    if (passengerAuthMain) {
        passengerAuthMain.hidden = false;
        passengerAuthMain.removeAttribute("aria-hidden");
    }
    appSection.hidden = true;
    appSection.setAttribute("aria-hidden", "true");
    setAuthMessage("You have been logged out.", false);
}

function showApp() {
    document.body.classList.add("app-mode");
    if (passengerAuthMain) {
        passengerAuthMain.hidden = true;
        passengerAuthMain.setAttribute("aria-hidden", "true");
    }
    appSection.hidden = false;
    appSection.removeAttribute("aria-hidden");

    welcomeName.textContent = currentPassenger.name;
    welcomeEmail.textContent = currentPassenger.email;

    setupSocket();
    loadActiveRide();
    loadRideHistory();
    startFallbackPoll();
}

function setupSocket() {
    const s = connectSocket();
    if (!s) return;

    s.off("ride:status");
    s.on("ride:status", (data) => {
        if (!activeRide || data.id !== activeRide.requestId) return;
        applyRideData(data);
        showRideCard();
    });
}

async function loadActiveRide() {
    try {
        const response = await authFetch("/passenger/active-ride", {}, "passenger");
        const data = await response.json();

        if (!response.ok) return;

        if (data.ride) {
            applyRideData(data.ride);
            showRideCard();
            joinRideRoom(activeRide.requestId);
        } else {
            activeRide = null;
            rideStatusCard.hidden = true;
            if (noRideHint) noRideHint.hidden = false;
        }
    } catch (err) {
        console.warn("Could not load active ride:", err);
    }
}

async function loadRideHistory() {
    try {
        const response = await authFetch("/passenger/rides", {}, "passenger");
        const rides = await response.json();

        if (!Array.isArray(rides) || rides.length === 0) {
            rideHistory.innerHTML = "<p class='empty-note'>No rides yet. Request your first ride above!</p>";
            return;
        }

        rideHistory.innerHTML = rides
            .map((ride) => {
                const label = STATUS_LABEL[ride.status] || ride.status;
                const driver = ride.driver_name
                    ? `<br><small>Driver: ${escapeHtml(ride.driver_name)}</small>`
                    : "";
                return `
                    <div class="card card-status-${ride.status}">
                        <strong>#${ride.id}</strong> · ${escapeHtml(ride.location)} → ${escapeHtml(ride.destination || "—")}<br>
                        <small>${label}</small>${driver}
                    </div>
                `;
            })
            .join("");
    } catch (err) {
        rideHistory.innerHTML = "<p class='empty-note'>Could not load ride history.</p>";
    }
}

function applyRideData(data) {
    activeRide = {
        requestId: data.id,
        name: data.name,
        location: data.location,
        destination: data.destination,
        status: normalizeStatus(data.status),
        driverName: data.driver_name || null,
        driverPhone: data.driver_phone || null
    };
    sessionStorage.setItem("kekeActiveRide", JSON.stringify(activeRide));
}

async function onSubmit(e) {
    e.preventDefault();

    const location = document.getElementById("location").value;
    const destination = document.getElementById("destination").value;

    if (!location) {
        showMessage("Please select a pickup location.");
        return;
    }

    if (!destination) {
        showMessage("Please select a destination.");
        return;
    }

    if (location === destination) {
        showMessage("Pickup and destination must be different.");
        return;
    }

    showMessage("Finding you a driver...");

    try {
        const response = await authFetch("/request", {
            method: "POST",
            body: JSON.stringify({ location, destination })
        }, "passenger");
        const data = await response.json();

        if (!response.ok || data.error) {
            showMessage(data.error || "Could not submit your ride request.");
            return;
        }

        activeRide = {
            requestId: Number(data.requestId),
            name: currentPassenger.name,
            location,
            destination,
            status: data.status || "waiting",
            driverName: data.driver ? data.driver.name : null,
            driverPhone: data.driver ? data.driver.phone : null
        };

        sessionStorage.setItem("kekeActiveRide", JSON.stringify(activeRide));
        showRideCard();
        joinRideRoom(activeRide.requestId);
        loadRideHistory();
    } catch (err) {
        showMessage(getFetchErrorMessage(err));
    }
}

function startFallbackPoll() {
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    fallbackPollTimer = setInterval(async () => {
        await loadActiveRide();
        await loadRideHistory();
    }, 15000);
}

function showRideCard() {
    if (!activeRide) return;

    hideMessage();

    const status = normalizeStatus(activeRide.status);
    const label = STATUS_LABEL[status] || status.toUpperCase();
    const color = STATUS_COLOR[status] || "gray";
    const hasDriver =
        activeRide.driverName &&
        ["assigned", "in_progress", "arriving", "accepted"].includes(status);

    statusTitle.textContent = "Your Live Ride";
    statusHint.textContent = getStatusHint(status);
    statusName.textContent = activeRide.name || "—";
    statusLocation.textContent = activeRide.location || "—";
    if (statusDestination) {
        statusDestination.textContent = activeRide.destination || "—";
    }
    statusValue.textContent = label;
    statusValue.className = `status-chip ${STATUS_CLASS[status] || ""}`;
    statusValue.style.color = "";

    if (hasDriver) {
        driverInfoBlock.hidden = false;
        statusDriverName.textContent = activeRide.driverName;
        statusDriverPhone.textContent = activeRide.driverPhone || "—";
    } else {
        driverInfoBlock.hidden = true;
    }

    rideStatusCard.hidden = false;
    if (noRideHint) noRideHint.hidden = true;
}

function getStatusHint(status) {
    const hints = {
        waiting: "Dispatch is searching for the next available campus driver.",
        assigned: "A driver is on the route. They will pick you up at your location.",
        in_progress: "You are in the vehicle. The driver will drop you at your destination.",
        arriving: "You are in the vehicle. The driver will drop you at your destination.",
        accepted: "You are in the vehicle. The driver will drop you at your destination.",
        completed: "This ride has been completed. Thank you for using QueueGo.",
        rejected: "This ride request was cancelled or rejected."
    };
    return hints[status] || "Your ride is being monitored in real time.";
}

function showMessage(text) {
    rideStatusCard.hidden = true;
    statusMessage.textContent = text;
    statusMessage.hidden = false;
}

function hideMessage() {
    statusMessage.textContent = "";
    statusMessage.hidden = true;
}

function normalizeStatus(status) {
    if (!status || typeof status !== "string") return "waiting";
    return status.trim().toLowerCase() || "waiting";
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

function restoreSession() {
    const token = getPassengerToken();
    const saved = sessionStorage.getItem("kekePassenger");

    if (!token || !saved) return;

    try {
        currentPassenger = JSON.parse(saved);
        showApp();
    } catch (err) {
        logout();
    }
}

restoreSession();
