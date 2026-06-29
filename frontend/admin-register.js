const adminRegisterForm = document.getElementById("adminRegisterForm");
const adminRegisterMessage = document.getElementById("adminRegisterMessage");
const adminRegisterBtn = document.getElementById("adminRegisterBtn");
const registerIntro = document.getElementById("registerIntro");
const inviteCodeField = document.getElementById("inviteCodeField");
const closedRegistration = document.getElementById("closedRegistration");
const setupStatusBadge = document.getElementById("setupStatusBadge");

function setSetupBadge(text, variant) {
    if (!setupStatusBadge) return;
    setupStatusBadge.textContent = text;
    setupStatusBadge.className = `setup-status-badge setup-status-badge--${variant}`;
}

warmUpServer();
loadSetupStatus();

adminRegisterForm.addEventListener("submit", onRegister);

function setMessage(text, isError) {
    adminRegisterMessage.textContent = text;
    adminRegisterMessage.style.color = isError ? "#c62828" : "#0369a1";
}

async function loadSetupStatus() {
    try {
        const response = await fetchWithRetry(`${API_BASE}/auth/admin/setup-status`);
        const data = await parseJsonResponse(response);

        if (!response.ok) {
            registerIntro.textContent = "Could not load registration status.";
            return;
        }

        if (data.openRegistration) {
            registerIntro.textContent = data.hasAdmins
                ? "Self-registration is open. Create your operations account below, then sign in at /staff."
                : "You're setting up the first operations account. Once created, your team can sign in at /staff.";
            inviteCodeField.hidden = true;
            setSetupBadge(data.hasAdmins ? "Open registration" : "First-time setup", "open");
            if (closedRegistration) closedRegistration.hidden = true;
            adminRegisterForm.hidden = false;
            return;
        }

        if (!data.hasAdmins) {
            registerIntro.textContent =
                "You're setting up the first operations account. Once created, your team can sign in at /staff.";
            inviteCodeField.hidden = true;
            setSetupBadge("First-time setup", "open");
            return;
        }

        if (data.inviteConfigured) {
            registerIntro.textContent =
                "Your team is already set up. Enter the invite code from your lead to join the control room.";
            inviteCodeField.hidden = false;
            document.getElementById("adminInviteCode").required = true;
            setSetupBadge("Invite required", "invite");
            return;
        }

        registerIntro.textContent =
            "Self-registration is closed. Ask an existing admin to add your account from the control room.";
        adminRegisterForm.hidden = true;
        if (closedRegistration) closedRegistration.hidden = false;
        setSetupBadge("Closed", "closed");
    } catch (err) {
        registerIntro.textContent = getFetchErrorMessage(err);
    }
}

async function onRegister(e) {
    e.preventDefault();

    const name = document.getElementById("adminRegisterName").value.trim();
    const email = document.getElementById("adminRegisterEmail").value.trim();
    const password = document.getElementById("adminRegisterPassword").value;
    const inviteCode = document.getElementById("adminInviteCode").value.trim();

    if (!name || !email || !password) {
        setMessage("Please fill in name, email, and password.", true);
        return;
    }

    if (password.length < 6) {
        setMessage("Password must be at least 6 characters.", true);
        return;
    }

    adminRegisterBtn.disabled = true;
    adminRegisterBtn.querySelector(".btn-text").textContent = "Creating account...";
    setMessage("");

    try {
        const { response, data } = await postJson("/auth/admin/register", {
            name,
            email,
            password,
            inviteCode
        });

        if (!response.ok || data.error) {
            setMessage(data.error || "Registration failed.", true);
            adminRegisterBtn.disabled = false;
            adminRegisterBtn.querySelector(".btn-text").textContent = "Create staff account";
            return;
        }

        setMessage("Account created! Redirecting to sign-in...", false);

        setTimeout(() => {
            const params = new URLSearchParams({ registered: "1", email });
            window.location.href = `/staff?${params.toString()}`;
        }, 1200);
    } catch (err) {
        setMessage(getFetchErrorMessage(err), true);
        adminRegisterBtn.disabled = false;
        adminRegisterBtn.querySelector(".btn-text").textContent = "Create staff account";
    }
}
