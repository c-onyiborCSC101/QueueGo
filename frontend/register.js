const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("registerMessage");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

warmUpServer();
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
        const { response, data } = await postJson("/auth/passenger/register", {
            name,
            email,
            phone,
            password
        });

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
        setMessage(getFetchErrorMessage(err), true);
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = "Create account";
    }
}
