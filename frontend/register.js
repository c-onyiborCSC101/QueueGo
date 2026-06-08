const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("registerMessage");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

registerForm.addEventListener("submit", onRegister);

function setMessage(text, isError) {
    registerMessage.textContent = text;
    registerMessage.style.color = isError ? "#c62828" : "#2e7d32";
}

async function onRegister(e) {
    e.preventDefault();

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const phone = document.getElementById("registerPhone").value.trim();
    const password = document.getElementById("registerPassword").value;

    if (!name || !email || !password) {
        setMessage("Please fill in name, email, and password.", true);
        return;
    }

    if (password.length < 4) {
        setMessage("Password must be at least 4 characters.", true);
        return;
    }

    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = "Creating account...";
    setMessage("");

    try {
        const response = await fetch(`${API_BASE}/auth/passenger/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, phone, password })
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            setMessage(data.error || "Registration failed. Please try again.", true);
            registerSubmitBtn.disabled = false;
            registerSubmitBtn.textContent = "Create account";
            return;
        }

        setMessage("Account created! Redirecting you to log in...", false);

        const params = new URLSearchParams({
            registered: "1",
            email
        });

        setTimeout(() => {
            window.location.href = `/passenger?${params.toString()}`;
        }, 1200);
    } catch (err) {
        setMessage("Cannot reach server. Run npm start in the backend folder.", true);
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = "Create account";
    }
}
