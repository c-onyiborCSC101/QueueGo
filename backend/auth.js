const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "pau-keke-fyp-secret-change-in-production";
const PASSWORD_PEPPER =
    process.env.PASSWORD_PEPPER || process.env.JWT_SECRET || "queuego-password-pepper";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pauadmin";

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(`${PASSWORD_PEPPER}:${String(password)}`)
        .digest("hex");
}

/** Legacy hashes from older builds that mixed JWT_SECRET into password hashing. */
function hashPasswordLegacy(password) {
    return crypto
        .createHash("sha256")
        .update(`${String(password)}:${JWT_SECRET}`)
        .digest("hex");
}

function verifyPassword(password, storedHash) {
    if (!storedHash) return false;
    const current = hashPassword(password);
    if (current === storedHash) return true;
    return hashPasswordLegacy(password) === storedHash;
}

function signAdminToken(adminId) {
    return jwt.sign({ role: "admin", adminId: Number(adminId) }, JWT_SECRET, { expiresIn: "8h" });
}

function signDriverToken(driverId) {
    return jwt.sign({ role: "driver", driverId: Number(driverId) }, JWT_SECRET, {
        expiresIn: "12h"
    });
}

function signPassengerToken(passengerId) {
    return jwt.sign({ role: "passenger", passengerId: Number(passengerId) }, JWT_SECRET, {
        expiresIn: "7d"
    });
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

function getBearerToken(req) {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
        return header.slice(7);
    }
    return null;
}

function requireAdmin(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: "Admin login required." });
        }
        const payload = verifyToken(token);
        if (payload.role !== "admin") {
            return res.status(403).json({ error: "Admin access only." });
        }
        req.auth = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired admin session." });
    }
}

function requirePassenger(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: "Please log in to continue." });
        }
        const payload = verifyToken(token);
        if (payload.role !== "passenger") {
            return res.status(403).json({ error: "Passenger access only." });
        }
        req.auth = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    }
}

function requireDriver(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: "Driver login required." });
        }
        const payload = verifyToken(token);
        if (payload.role !== "driver") {
            return res.status(403).json({ error: "Driver access only." });
        }
        const routeDriverId = Number(req.params.driverId);
        if (routeDriverId && payload.driverId !== routeDriverId) {
            return res.status(403).json({ error: "Not authorized for this driver profile." });
        }
        req.auth = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired driver session." });
    }
}

module.exports = {
    ADMIN_PASSWORD,
    signAdminToken,
    signDriverToken,
    signPassengerToken,
    hashPassword,
    verifyPassword,
    requireAdmin,
    requireDriver,
    requirePassenger
};
