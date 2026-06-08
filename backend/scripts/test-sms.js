/**
 * Send a test SMS to verify Termii is configured.
 *
 * Usage (from backend folder):
 *   node scripts/test-sms.js 08012345678
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

const { sendSms } = require("../sms");

const phone = process.argv[2];

if (!phone) {
    console.error("Usage: node scripts/test-sms.js <phone>");
    console.error("Example: node scripts/test-sms.js 08012345678");
    process.exit(1);
}

const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();

if (provider !== "termii" && provider !== "africastalking") {
    console.error(
        "SMS_PROVIDER is not set to termii (or africastalking). Update backend/.env first."
    );
    process.exit(1);
}

if (provider === "termii" && !process.env.TERMII_API_KEY) {
    console.error("TERMII_API_KEY is missing in backend/.env");
    process.exit(1);
}

const message =
    "QueueGo test: SMS is working. You can now receive ride alerts on this number.";

sendSms(phone, message)
    .then((result) => {
        console.log("Result:", result);
        if (result.ok) {
            console.log("Check your phone in a few seconds.");
        } else {
            process.exit(1);
        }
    })
    .catch((err) => {
        console.error("Failed:", err.message);
        process.exit(1);
    });
