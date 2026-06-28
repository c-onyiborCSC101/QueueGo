/**
 * SMS notifications for QueueGo.
 *
 * Set SMS_PROVIDER in .env:
 *   - console (default) — logs messages locally for demos
 *   - termii — https://termii.com (popular in Nigeria)
 *   - africastalking — https://africastalking.com
 */

const SMS_PROVIDER = (process.env.SMS_PROVIDER || "console").toLowerCase();

/** Last assign in console demo — lets driver reply by typing 1/0 in the server terminal */
let lastConsoleAssign = null;
const TERMII_API_KEY = process.env.TERMII_API_KEY || "";
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "QueueGo";
/** dnd = transactional (better delivery, DND numbers). generic = promotional. */
const TERMII_CHANNEL = process.env.TERMII_CHANNEL || "dnd";
const AT_API_KEY = process.env.AT_API_KEY || "";
const AT_USERNAME = process.env.AT_USERNAME || "";

function formatNigerianPhone(phone) {
    if (!phone) return null;

    let digits = String(phone).replace(/\D/g, "");

    if (digits.startsWith("0")) {
        digits = "234" + digits.slice(1);
    } else if (!digits.startsWith("234")) {
        digits = "234" + digits;
    }

    if (digits.length < 12 || digits.length > 14) {
        return null;
    }

    return digits;
}

function buildDriverAssignMessage({ passengerName, pickup, destination, requestId }) {
    const dropLine = destination ? `Destination: ${destination}\n` : "";
    return (
        `QueueGo: New ride #${requestId}.\n` +
        `Passenger: ${passengerName}\n` +
        `Pickup: ${pickup}\n` +
        dropLine +
        `Reply 1 = Accept\n` +
        `Reply 0 = Reject`
    );
}

function phonesMatch(phoneA, phoneB) {
    const a = formatNigerianPhone(phoneA);
    const b = formatNigerianPhone(phoneB);
    return Boolean(a && b && a === b);
}

/**
 * Parse driver SMS reply: 1 = accept, 0 = reject.
 */
function parseDriverReplyAction(text) {
    if (!text) return null;

    const normalized = String(text).trim().toLowerCase();
    const first = normalized.split(/\s+/)[0];

    if (["1", "accept", "yes", "ok", "y"].includes(first)) {
        return "accept";
    }

    if (["0", "reject", "decline", "no", "n"].includes(first)) {
        return "reject";
    }

    return null;
}

/**
 * Normalize inbound webhook payloads (Termii, Africa's Talking, manual test).
 */
function parseInboundPayload(body) {
    if (!body || typeof body !== "object") {
        return null;
    }

    // Termii delivery reports (outbound) — not driver replies
    if (body.type && String(body.type).toLowerCase() !== "inbound") {
        return null;
    }

    const phone =
        body.sender ||
        body.phone ||
        body.from ||
        body.msisdn ||
        body.senderNumber ||
        body.sender_number;

    const message =
        body.message ||
        body.text ||
        body.content ||
        body.sms ||
        body.body;

    if (!phone || message === undefined) {
        return null;
    }

    return { phone: String(phone), message: String(message) };
}

async function sendViaTermii(phone, message) {
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: TERMII_API_KEY,
            to: phone,
            from: TERMII_SENDER_ID,
            sms: message,
            type: "plain",
            channel: TERMII_CHANNEL
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const detail =
            data.message ||
            data.error ||
            (Array.isArray(data.errors) ? data.errors.join(", ") : null) ||
            `Termii HTTP ${response.status}`;
        throw new Error(detail);
    }

    return data;
}

async function sendViaAfricaTalking(phone, message) {
    const body = new URLSearchParams({
        username: AT_USERNAME,
        to: phone,
        message
    });

    const response = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
            apiKey: AT_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
        },
        body: body.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.errorMessage || "Africa's Talking SMS failed");
    }

    return data;
}

async function sendSms(phone, message) {
    const formatted = formatNigerianPhone(phone);

    if (!formatted) {
        console.warn("[SMS] Invalid phone number:", phone);
        return { ok: false, reason: "invalid_phone" };
    }

    if (SMS_PROVIDER === "console" || !SMS_PROVIDER) {
        console.log("\n--- SMS (demo mode) ---");
        console.log("To:", formatted);
        console.log(message);
        console.log("-----------------------");
        return { ok: true, mode: "console" };
    }

    if (SMS_PROVIDER === "termii") {
        if (!TERMII_API_KEY) {
            console.warn("[SMS] TERMII_API_KEY missing — logging instead.");
            console.log("\n--- SMS (demo mode) ---\nTo:", formatted, "\n", message, "\n");
            return { ok: true, mode: "console" };
        }
        await sendViaTermii(formatted, message);
        return { ok: true, mode: "termii" };
    }

    if (SMS_PROVIDER === "africastalking") {
        if (!AT_API_KEY || !AT_USERNAME) {
            console.warn("[SMS] AT_API_KEY / AT_USERNAME missing — logging instead.");
            console.log("\n--- SMS (fallback) ---\nTo:", formatted, "\n", message, "\n");
            return { ok: true, mode: "console" };
        }
        await sendViaAfricaTalking(formatted, message);
        return { ok: true, mode: "africastalking" };
    }

    console.warn("[SMS] Unknown SMS_PROVIDER:", SMS_PROVIDER);
    return { ok: false, reason: "unknown_provider" };
}

/**
 * Notify driver when a ride is auto-assigned or reassigned to them.
 */
async function notifyDriverOnAssign({ driver, request }) {
    if (!driver || !driver.phone || !request) {
        return;
    }

    const message = buildDriverAssignMessage({
        passengerName: request.name,
        pickup: request.location,
        destination: request.destination,
        requestId: request.id
    });

    try {
        const result = await sendSms(driver.phone, message);
        console.log(
            `[SMS] Driver notify #${request.id} → ${driver.name}:`,
            result.ok ? result.mode || "sent" : result.reason
        );

        if (SMS_PROVIDER === "console") {
            lastConsoleAssign = {
                phone: driver.phone,
                driverId: driver.id,
                requestId: request.id,
                driverName: driver.name,
                passengerName: request.name,
                pickup: request.location
            };
            console.log(
                "\n>>> DEMO: In this terminal, type 1 + Enter = Accept  |  0 + Enter = Reject\n"
            );
        }
    } catch (err) {
        console.error("[SMS] Driver notify failed:", err.message);
    }
}

function getLastConsoleAssign() {
    return lastConsoleAssign;
}

function isConsoleSmsMode() {
    return SMS_PROVIDER === "console";
}

function isSmsEnabled() {
    return SMS_PROVIDER !== "off" && SMS_PROVIDER !== "false";
}

function isTermiiMode() {
    return SMS_PROVIDER === "termii";
}

function getInboundWebhookPath() {
    return "/webhooks/sms/inbound";
}

function getSmsStatus(publicBaseUrl) {
    const base = publicBaseUrl ? String(publicBaseUrl).replace(/\/$/, "") : null;
    const termiiReady = isTermiiMode() && Boolean(TERMII_API_KEY);

    return {
        provider: SMS_PROVIDER,
        enabled: isSmsEnabled(),
        termiiConfigured: termiiReady,
        senderId: TERMII_SENDER_ID,
        channel: TERMII_CHANNEL,
        inboundWebhookUrl: base ? `${base}${getInboundWebhookPath()}` : null,
        features: {
            driverWelcomePin: termiiReady || SMS_PROVIDER === "console" || SMS_PROVIDER === "africastalking",
            rideAssignAlerts: isSmsEnabled(),
            smsReplyAcceptReject: isSmsEnabled()
        }
    };
}

function buildDriverWelcomeMessage({ driverName, pin, portalUrl }) {
    return (
        `QueueGo — driver account ready.\n` +
        `Hi ${driverName}, operations registered you as a driver.\n` +
        `Sign in: ${portalUrl}\n` +
        `Select your name, then enter PIN: ${pin}\n` +
        `Keep this PIN private.`
    );
}

async function notifyDriverWelcome({ driver, pin, portalUrl }) {
    if (!driver || !driver.phone) {
        return { ok: false, reason: "no_phone" };
    }

    const message = buildDriverWelcomeMessage({
        driverName: driver.name,
        pin,
        portalUrl: portalUrl || "http://localhost:3000/driver"
    });

    try {
        return await sendSms(driver.phone, message);
    } catch (err) {
        console.error("[SMS] Driver welcome failed:", err.message);
        return { ok: false, reason: err.message };
    }
}

async function notifyDriverSmsResult(phone, message) {
    try {
        await sendSms(phone, message);
    } catch (err) {
        console.error("[SMS] Confirmation failed:", err.message);
    }
}

module.exports = {
    sendSms,
    notifyDriverOnAssign,
    notifyDriverWelcome,
    notifyDriverSmsResult,
    formatNigerianPhone,
    phonesMatch,
    parseDriverReplyAction,
    parseInboundPayload,
    isSmsEnabled,
    isTermiiMode,
    getInboundWebhookPath,
    getSmsStatus,
    getLastConsoleAssign,
    isConsoleSmsMode
};
