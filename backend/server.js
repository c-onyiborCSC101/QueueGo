const fs = require("fs");
const http = require("http");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const envPath = path.join(__dirname, ".env");
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

const {
    ADMIN_PASSWORD,
    signAdminToken,
    signDriverToken,
    signPassengerToken,
    hashPassword,
    requireAdmin,
    requireDriver,
    requirePassenger
} = require("./auth");
const { initRealtime, notifyRideChange, emitRidesUpdated, emitDriverUpdated } = require("./realtime");
const readline = require("readline");
const { distanceUnits, estimateMinutes, DEFAULT_HUB, getLocationList } = require("./campusLocations");
const {
    optimizeDriverBatch,
    findDriverForNewRequest,
    getDriverBatchRides,
    countDriverBatchRides,
    getDriverBatchPayload
} = require("./batchDispatch");
const {
    notifyDriverOnAssign,
    notifyDriverWelcome,
    notifyDriverSmsResult,
    isSmsEnabled,
    phonesMatch,
    parseDriverReplyAction,
    parseInboundPayload,
    getLastConsoleAssign,
    isConsoleSmsMode,
    isTermiiMode,
    getInboundWebhookPath,
    getSmsStatus
} = require("./sms");

const WAIT_THRESHOLD_MINUTES = Number(process.env.WAIT_THRESHOLD_MINUTES || 5);

const ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE || "";
const ADMIN_OPEN_REGISTRATION = process.env.ADMIN_OPEN_REGISTRATION === "true";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
const frontendDir = path.join(__dirname, "../frontend");

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendDir, "home.html"));
});

app.get("/passenger", (req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
});

app.get("/passenger/register", (req, res) => {
    res.sendFile(path.join(frontendDir, "register.html"));
});

app.get("/driver", (req, res) => {
    res.sendFile(path.join(frontendDir, "driver.html"));
});

app.get("/staff", (req, res) => {
    res.sendFile(path.join(frontendDir, "admin.html"));
});

app.get("/staff/register", (req, res) => {
    res.sendFile(path.join(frontendDir, "admin-register.html"));
});

app.use(express.static(frontendDir));

const db = new sqlite3.Database("./database.db");

function broadcast(requestId, driverId) {
    notifyRideChange(getRequestWithDriver, requestId, driverId);
}

function broadcastDriverBatch(driverId) {
    getDriverBatchRides(db, Number(driverId), (err, rides) => {
        if (err) {
            console.warn("[Batch] broadcast error:", err.message);
            return;
        }
        rides.forEach((ride) => broadcast(ride.id, Number(driverId)));
        emitDriverUpdated(Number(driverId));
    });
}

function afterBatchMutation(driverId, requestId, callback) {
    optimizeDriverBatch(db, Number(driverId), (optErr) => {
        if (optErr) return callback(optErr);
        broadcast(requestId, Number(driverId));
        broadcastDriverBatch(Number(driverId));
        callback(null);
    });
}

const ACTIVE_RIDE_STATUSES = ['assigned', 'in_progress', 'arriving', 'accepted'];

db.run(`
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    location TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'waiting',
    driver_id INTEGER
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    pin TEXT DEFAULT '1234',
    status TEXT DEFAULT 'available',
    last_location TEXT
)
`);

db.run("ALTER TABLE drivers ADD COLUMN last_location TEXT", () => {});
db.run("ALTER TABLE requests ADD COLUMN destination TEXT", () => {});
db.run("ALTER TABLE requests ADD COLUMN stop_order INTEGER", () => {});

db.run("ALTER TABLE drivers ADD COLUMN pin TEXT DEFAULT '1234'", () => {});

db.run(`
CREATE TABLE IF NOT EXISTS passengers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

db.run("ALTER TABLE requests ADD COLUMN passenger_id INTEGER", () => {});

db.run(`
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

function countAdmins(callback) {
    db.get("SELECT COUNT(*) AS count FROM admins", [], (err, row) => {
        if (err) return callback(err);
        callback(null, row ? row.count : 0);
    });
}

function getPortalBaseUrl(req) {
    if (process.env.PUBLIC_URL) {
        return String(process.env.PUBLIC_URL).replace(/\/$/, "");
    }
    const host = req.get("host");
    const protocol = req.protocol || "http";
    return host ? `${protocol}://${host}` : `http://localhost:${PORT}`;
}

app.get("/auth/admin/setup-status", (req, res) => {
    countAdmins((err, count) => {
        if (err) return res.status(500).json({ error: err.message });

        const hasAdmins = count > 0;
        const inviteConfigured = Boolean(ADMIN_INVITE_CODE);
        res.json({
            hasAdmins,
            openRegistration: ADMIN_OPEN_REGISTRATION,
            canSelfRegister: !hasAdmins || ADMIN_OPEN_REGISTRATION || inviteConfigured,
            needsInviteCode: hasAdmins && !ADMIN_OPEN_REGISTRATION && inviteConfigured,
            inviteConfigured
        });
    });
});

app.post("/auth/admin/register", (req, res) => {
    const { name, email, password, inviteCode } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    countAdmins((err, count) => {
        if (err) return res.status(500).json({ error: err.message });

        if (count > 0 && !ADMIN_OPEN_REGISTRATION) {
            if (!ADMIN_INVITE_CODE) {
                return res.status(403).json({
                    error: "Staff self-registration is closed. Ask an existing admin to add your account."
                });
            }
            if (String(inviteCode || "").trim() !== ADMIN_INVITE_CODE) {
                return res.status(403).json({ error: "Invalid staff invite code." });
            }
        }

        db.run(
            "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
            [name.trim(), normalizedEmail, passwordHash],
            function (insertErr) {
                if (insertErr) {
                    if (String(insertErr.message).includes("UNIQUE")) {
                        return res.status(409).json({ error: "An account with this email already exists." });
                    }
                    return res.status(500).json({ error: insertErr.message });
                }

                const adminId = this.lastID;
                res.json({
                    message: count === 0
                        ? "First staff account created. You can sign in now."
                        : "Staff account created. You can sign in now.",
                    token: signAdminToken(adminId),
                    admin: { id: adminId, name: name.trim(), email: normalizedEmail }
                });
            }
        );
    });
});

app.post("/auth/passenger/register", (req, res) => {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters." });
    }

    const passwordHash = hashPassword(password);
    const normalizedEmail = String(email).trim().toLowerCase();

    db.run(
        "INSERT INTO passengers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)",
        [name.trim(), normalizedEmail, phone || null, passwordHash],
        function (err) {
            if (err) {
                if (String(err.message).includes("UNIQUE")) {
                    return res.status(409).json({ error: "An account with this email already exists." });
                }
                return res.status(500).json({ error: err.message });
            }

            const passengerId = this.lastID;
            res.json({
                message: "Account created successfully.",
                token: signPassengerToken(passengerId),
                passenger: { id: passengerId, name: name.trim(), email: normalizedEmail, phone }
            });
        }
    );
});

app.post("/auth/passenger/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    db.get("SELECT * FROM passengers WHERE email = ?", [normalizedEmail], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || row.password_hash !== passwordHash) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        res.json({
            message: "Welcome back!",
            token: signPassengerToken(row.id),
            passenger: {
                id: row.id,
                name: row.name,
                email: row.email,
                phone: row.phone
            }
        });
    });
});

app.get("/passenger/me", requirePassenger, (req, res) => {
    db.get("SELECT id, name, email, phone FROM passengers WHERE id = ?", [req.auth.passengerId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Passenger not found." });
        res.json({ passenger: row });
    });
});

app.get("/passenger/active-ride", requirePassenger, (req, res) => {
    const passengerId = req.auth.passengerId;
    const activeStatuses = ["waiting", "assigned", "in_progress", "arriving", "accepted"];
    const placeholders = activeStatuses.map(() => "?").join(", ");

    db.get(
        `${REQUEST_WITH_DRIVER_SQL}
         WHERE r.passenger_id = ? AND r.status IN (${placeholders})
         ORDER BY r.timestamp DESC LIMIT 1`,
        [passengerId, ...activeStatuses],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ride: row || null });
        }
    );
});

app.get("/passenger/rides", requirePassenger, (req, res) => {
    const passengerId = req.auth.passengerId;

    db.all(
        `${REQUEST_WITH_DRIVER_SQL}
         WHERE r.passenger_id = ?
         ORDER BY r.timestamp DESC
         LIMIT 20`,
        [passengerId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post("/auth/admin/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    db.get("SELECT * FROM admins WHERE email = ?", [normalizedEmail], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row && row.password_hash === passwordHash) {
            return res.json({
                token: signAdminToken(row.id),
                message: "Welcome back.",
                admin: { id: row.id, name: row.name, email: row.email }
            });
        }

        countAdmins((countErr, count) => {
            if (countErr) return res.status(500).json({ error: countErr.message });

            if (count === 0 && password === ADMIN_PASSWORD) {
                return res.status(409).json({
                    error: "No staff accounts yet. Create the first one at /staff/register."
                });
            }

            return res.status(401).json({ error: "Invalid email or password." });
        });
    });
});

app.post("/admin/staff", requireAdmin, (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    db.run(
        "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
        [name.trim(), normalizedEmail, passwordHash],
        function (err) {
            if (err) {
                if (String(err.message).includes("UNIQUE")) {
                    return res.status(409).json({ error: "An account with this email already exists." });
                }
                return res.status(500).json({ error: err.message });
            }

            res.json({
                message: "Staff account created.",
                admin: { id: this.lastID, name: name.trim(), email: normalizedEmail }
            });
        }
    );
});

app.post("/auth/driver/login", (req, res) => {
    const { driverId, pin } = req.body;
    if (!driverId || !pin) {
        return res.status(400).json({ error: "Driver ID and PIN are required." });
    }

    db.get("SELECT * FROM drivers WHERE id = ?", [driverId], (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: "Driver not found." });
        if (String(driver.pin || "1234") !== String(pin)) {
            return res.status(401).json({ error: "Incorrect PIN." });
        }
        res.json({
            token: signDriverToken(driver.id),
            driverId: driver.id,
            name: driver.name,
            message: "Driver logged in."
        });
    });
});

const REQUEST_WITH_DRIVER_SQL = `
    SELECT
        r.*,
        d.name AS driver_name,
        d.phone AS driver_phone,
        d.status AS driver_status
    FROM requests r
    LEFT JOIN drivers d ON r.driver_id = d.id
`;

function listAvailableDrivers(excludeDriverId, callback) {
    let sql = "SELECT * FROM drivers WHERE status = 'available'";
    const params = [];

    if (excludeDriverId) {
        sql += " AND id != ?";
        params.push(excludeDriverId);
    }

    sql += " ORDER BY id ASC";

    db.all(sql, params, callback);
}

function findAvailableDriver(callback, excludeDriverId = null) {
    listAvailableDrivers(excludeDriverId, (err, drivers) => {
        if (err) return callback(err);
        callback(null, drivers[0] || null);
    });
}

function findNearestAvailableDriver(pickupLocation, excludeDriverId, callback) {
    listAvailableDrivers(excludeDriverId, (err, drivers) => {
        if (err) return callback(err);
        if (!drivers.length) return callback(null, null);

        let best = drivers[0];
        let bestDistance = Infinity;

        drivers.forEach((driver) => {
            const origin = driver.last_location || DEFAULT_HUB;
            const dist = distanceUnits(origin, pickupLocation);
            if (dist < bestDistance) {
                bestDistance = dist;
                best = driver;
            }
        });

        callback(null, best);
    });
}

function requestWaitMinutes(request) {
    const created = new Date(request.timestamp).getTime();
    if (Number.isNaN(created)) return 0;
    return (Date.now() - created) / 60000;
}

function selectDriverForRequest(request, excludeDriverId, callback) {
    findDriverForNewRequest(db, request.location, excludeDriverId, callback);
}

function driverPhoneInUse(phone, excludeDriverId, callback) {
    db.all("SELECT id, name, phone FROM drivers", [], (err, drivers) => {
        if (err) return callback(err);
        const duplicate = drivers.find(
            (driver) =>
                phonesMatch(driver.phone, phone) &&
                Number(driver.id) !== Number(excludeDriverId)
        );
        callback(null, duplicate || null);
    });
}

function assignDriverToRequest(requestId, driver, callback) {
    db.serialize(() => {
        db.run(
            "UPDATE requests SET status = 'assigned', driver_id = ? WHERE id = ?",
            [driver.id, requestId],
            (err) => {
                if (err) return callback(err);
                db.run(
                    "UPDATE drivers SET status = 'busy' WHERE id = ?",
                    [driver.id],
                    (err2) => {
                        if (err2) return callback(err2);

                        optimizeDriverBatch(db, driver.id, (optErr, batchInfo) => {
                            if (optErr) return callback(optErr);

                            db.get(
                                "SELECT * FROM requests WHERE id = ?",
                                [requestId],
                                (reqErr, request) => {
                                    if (!reqErr && request && isSmsEnabled()) {
                                        notifyDriverOnAssign({ driver, request });
                                    }
                                    broadcast(requestId, driver.id);
                                    broadcastDriverBatch(driver.id);
                                    callback(null, driver, batchInfo);
                                }
                            );
                        });
                    }
                );
            }
        );
    });
}

function assignOldestWaiting(callback, options = {}) {
    const { excludeDriverId = null, excludeRequestId = null } = options;

    let sql = "SELECT * FROM requests WHERE status = 'waiting'";
    const params = [];

    if (excludeRequestId) {
        sql += " AND id != ?";
        params.push(excludeRequestId);
    }

    sql += " ORDER BY timestamp ASC LIMIT 1";

    db.get(sql, params, (err, request) => {
        if (err) return callback(err, null);
        if (!request) return callback(null, null);

        selectDriverForRequest(request, excludeDriverId, (findErr, driver) => {
            if (findErr) return callback(findErr, null);
            if (!driver) return callback(null, null);

            assignDriverToRequest(request.id, driver, (assignErr, assignedDriver) => {
                if (assignErr) return callback(assignErr, null);
                callback(null, { request, driver: assignedDriver });
            });
        }, excludeDriverId);
    });
}

function freeDriver(driverId, callback) {
    if (!driverId) return callback(null);
    db.run(
        "UPDATE drivers SET status = 'available' WHERE id = ?",
        [driverId],
        callback
    );
}

function freeDriverAndDispatch(driverId, callback, dispatchOptions = {}) {
    freeDriver(driverId, (err) => {
        if (err) return callback(err);
        assignOldestWaiting((dispatchErr, result) => {
            callback(dispatchErr, result);
        }, dispatchOptions);
    });
}

function getRequestWithDriver(requestId, callback) {
    db.get(
        `${REQUEST_WITH_DRIVER_SQL} WHERE r.id = ?`,
        [requestId],
        callback
    );
}

app.get("/locations", (req, res) => {
    res.json(getLocationList());
});

app.post("/request", requirePassenger, (req, res) => {
    const { location, destination } = req.body;
    const passengerId = req.auth.passengerId;

    if (!location) {
        return res.status(400).json({ error: "Pickup location is required." });
    }

    if (!destination) {
        return res.status(400).json({ error: "Destination is required." });
    }

    if (location === destination) {
        return res.status(400).json({ error: "Pickup and destination must be different." });
    }

    db.get("SELECT * FROM passengers WHERE id = ?", [passengerId], (err, passenger) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!passenger) return res.status(404).json({ error: "Passenger not found." });

        const name = passenger.name;

        db.get(
            `SELECT id FROM requests WHERE passenger_id = ? AND status IN ('waiting','assigned','in_progress','arriving','accepted')`,
            [passengerId],
            (activeErr, existing) => {
                if (activeErr) return res.status(500).json({ error: activeErr.message });
                if (existing) {
                    return res.status(400).json({
                        error: "You already have an active ride. Wait for it to finish before booking again."
                    });
                }

                db.run(
                    "INSERT INTO requests (name, location, destination, passenger_id) VALUES (?, ?, ?, ?)",
                    [name, location, destination, passengerId],
                    function (insertErr) {
                        if (insertErr) {
                            return res.status(500).json({ error: insertErr.message });
                        }

                        const requestId = this.lastID;

                        db.get(
                            "SELECT * FROM requests WHERE id = ?",
                            [requestId],
                            (reqErr, newRequest) => {
                                if (reqErr) {
                                    return res.status(500).json({ error: reqErr.message });
                                }

                                findDriverForNewRequest(
                                    db,
                                    newRequest.location,
                                    null,
                                    (findErr, driver) => {
                                        if (findErr) {
                                            return res.status(500).json({ error: findErr.message });
                                        }

                                        if (!driver) {
                                            broadcast(requestId, null);
                                            processWaitingQueue();
                                            return res.json({
                                                message: "Request added. Waiting for an available driver.",
                                                requestId,
                                                status: "waiting",
                                                driver: null
                                            });
                                        }

                                        assignDriverToRequest(requestId, driver, (assignErr) => {
                                            if (assignErr) {
                                                return res.status(500).json({ error: assignErr.message });
                                            }

                                            broadcast(requestId, driver.id);
                                            res.json({
                                                message: "Driver assigned automatically.",
                                                requestId,
                                                status: "assigned",
                                                driver: {
                                                    id: driver.id,
                                                    name: driver.name,
                                                    phone: driver.phone
                                                }
                                            });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

function processWaitingQueue() {
    assignOldestWaiting((err, result) => {
        if (err) {
            console.warn("[Dispatch] Waiting queue error:", err.message);
            return;
        }
        if (result && result.request && result.driver) {
            console.log(
                `[Dispatch] Auto-assigned ride #${result.request.id} (${result.request.location}) → ${result.driver.name}`
            );
            broadcast(result.request.id, result.driver.id);
            processWaitingQueue();
        }
    });
}

app.post("/driver", requireAdmin, (req, res) => {
    const { name, phone, pin } = req.body;
    const driverPin = pin || "1234";
    const portalUrl = `${getPortalBaseUrl(req)}/driver`;

    if (!phone) {
        return res.status(400).json({ error: "Driver phone is required for SMS dispatch." });
    }

    driverPhoneInUse(phone, null, (dupErr, duplicate) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (duplicate) {
            return res.status(409).json({
                error: `Phone number already used by driver "${duplicate.name}". Each driver needs a unique phone for SMS replies.`
            });
        }

    db.run(
        "INSERT INTO drivers (name, phone, pin) VALUES (?, ?, ?)",
        [name, phone, driverPin],
        async function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            const driverId = this.lastID;
            const driver = { id: driverId, name, phone };
            let smsResult = { ok: false, reason: "not_sent" };

            if (phone) {
                smsResult = await notifyDriverWelcome({
                    driver,
                    pin: driverPin,
                    portalUrl
                });
            }

            const smsMode = smsResult.mode || (smsResult.ok ? "sent" : null);
            if (isConsoleSmsMode() && phone) {
                console.log(
                    `[SMS] Driver welcome PIN for ${name} — printed above (console mode). ` +
                    `Set SMS_PROVIDER=termii in .env to send real texts.`
                );
            }

            emitRidesUpdated();
            res.json({
                message: "Driver registered successfully.",
                driverId,
                pin: driverPin,
                portalUrl,
                smsSent: Boolean(smsResult.ok),
                smsMode: smsMode,
                smsError: smsResult.ok ? null : smsResult.reason || null,
                smsIsConsole: isConsoleSmsMode()
            });
        }
    );
    });
});

app.get("/admin/sms/status", requireAdmin, (req, res) => {
    const publicBase = process.env.PUBLIC_URL || getPortalBaseUrl(req);
    res.json(getSmsStatus(publicBase));
});

app.get("/queue", requireAdmin, (req, res) => {
    db.all(
        `${REQUEST_WITH_DRIVER_SQL} ORDER BY r.timestamp ASC`,
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

app.get("/rides/history", requireAdmin, (req, res) => {
    db.all(
        `${REQUEST_WITH_DRIVER_SQL}
         WHERE r.status IN ('completed', 'rejected')
         ORDER BY r.timestamp DESC
         LIMIT 50`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.get("/dashboard-stats", requireAdmin, (req, res) => {
    const stats = {
        totalRequests: 0,
        waiting: 0,
        assigned: 0,
        in_progress: 0,
        arriving: 0,
        completed: 0,
        rejected: 0,
        availableDrivers: 0,
        busyDrivers: 0
    };

    db.all("SELECT status, COUNT(*) AS count FROM requests GROUP BY status", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        rows.forEach((row) => {
            stats.totalRequests += row.count;
            if (stats[row.status] !== undefined) {
                stats[row.status] = row.count;
            }
        });

        db.all("SELECT status, COUNT(*) AS count FROM drivers GROUP BY status", [], (err2, driverRows) => {
            if (err2) return res.status(500).json({ error: err2.message });

            driverRows.forEach((row) => {
                if (row.status === "available") stats.availableDrivers = row.count;
                if (row.status === "busy") stats.busyDrivers = row.count;
            });

            res.json(stats);
        });
    });
});

app.get("/request-status/:id", requirePassenger, (req, res) => {
    const requestId = req.params.id;
    const passengerId = req.auth.passengerId;

    getRequestWithDriver(requestId, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Request not found" });
        if (row.passenger_id && row.passenger_id !== passengerId) {
            return res.status(403).json({ error: "Not your ride." });
        }
        res.json(row);
    });
});

app.get("/drivers", (req, res) => {
    db.all(
        "SELECT id, name, phone, status FROM drivers ORDER BY status ASC, name ASC",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.delete("/driver/:id", requireAdmin, (req, res) => {
    const driverId = Number(req.params.id);
    if (!driverId) {
        return res.status(400).json({ error: "Invalid driver ID." });
    }

    const activeStatuses = ["assigned", "in_progress", "arriving", "accepted"];
    const placeholders = activeStatuses.map(() => "?").join(", ");

    db.all(
        `SELECT id FROM requests WHERE driver_id = ? AND status IN (${placeholders})`,
        [driverId, ...activeStatuses],
        (err, activeRides) => {
            if (err) return res.status(500).json({ error: err.message });

            const releaseActiveRides = (next) => {
                if (!activeRides.length) {
                    return next(null);
                }

                db.run(
                    `UPDATE requests SET status = 'waiting', driver_id = NULL
                     WHERE driver_id = ? AND status IN (${placeholders})`,
                    [driverId, ...activeStatuses],
                    (releaseErr) => {
                        if (releaseErr) return next(releaseErr);
                        activeRides.forEach((ride) => broadcast(ride.id, driverId));
                        next(null);
                    }
                );
            };

            releaseActiveRides((releaseErr) => {
                if (releaseErr) return res.status(500).json({ error: releaseErr.message });

                db.run("DELETE FROM drivers WHERE id = ?", [driverId], function (delErr) {
                    if (delErr) return res.status(500).json({ error: delErr.message });
                    if (this.changes === 0) {
                        return res.status(404).json({ error: "Driver not found." });
                    }

                    emitRidesUpdated();
                    processWaitingQueue();

                    const released = activeRides.length;
                    res.json({
                        message: released
                            ? `Driver removed. ${released} active ride(s) returned to the waiting queue.`
                            : "Driver removed from the fleet.",
                        releasedRides: released
                    });
                });
            });
        }
    );
});

function findDriverByPhone(phone, callback) {
    db.all("SELECT * FROM drivers", [], (err, drivers) => {
        if (err) return callback(err);
        const driver = drivers.find((d) => phonesMatch(d.phone, phone));
        callback(null, driver || null);
    });
}

function findAssignedRideForDriver(driverId, callback) {
    db.get(
        "SELECT * FROM requests WHERE driver_id = ? AND status = 'assigned' ORDER BY timestamp DESC LIMIT 1",
        [driverId],
        callback
    );
}

function findAssignedRideByPhone(phone, callback) {
    db.all(
        `${REQUEST_WITH_DRIVER_SQL} WHERE r.status = 'assigned' ORDER BY r.timestamp DESC`,
        [],
        (err, rows) => {
            if (err) return callback(err);
            const ride = rows.find((row) => phonesMatch(row.driver_phone, phone));
            callback(null, ride || null);
        }
    );
}

function handleDriverReplyForRide(driverId, requestId, messageText, callback) {
    const action = parseDriverReplyAction(messageText);

    if (!action) {
        return callback(null, {
            ok: false,
            error: "Invalid reply. Text 1 to Accept or 0 to Reject."
        });
    }

    db.get("SELECT phone, name FROM drivers WHERE id = ?", [driverId], (err, driver) => {
        if (err) return callback(err);
        if (!driver) {
            return callback(null, { ok: false, error: "Driver not found." });
        }

        if (action === "accept") {
            driverAcceptRide(Number(driverId), Number(requestId), (acceptErr, result) => {
                if (acceptErr) return callback(acceptErr);
                if (!result.ok) return callback(null, result);

                notifyDriverSmsResult(
                    driver.phone,
                    `QueueGo: Ride #${requestId} ACCEPTED.\nPassenger: ${result.ride.name}\nPickup: ${result.ride.location}\nHead there now.`
                );
                callback(null, { ok: true, action: "accept", ...result });
            });
            return;
        }

        driverRejectRide(Number(driverId), Number(requestId), (rejectErr, result) => {
            if (rejectErr) return callback(rejectErr);
            if (!result.ok) return callback(null, result);

            notifyDriverSmsResult(
                driver.phone,
                `QueueGo: Ride #${requestId} REJECTED.\nPassenger returned to waiting queue.`
            );
            callback(null, { ok: true, action: "reject", ...result });
        });
    });
}

function driverPickupPassenger(driverId, requestId, callback) {
    db.get(
        "SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status = 'assigned'",
        [requestId, driverId],
        (err, row) => {
            if (err) return callback(err);
            if (!row) {
                return callback(null, { ok: false, error: "No passenger waiting for pickup on this ride." });
            }

            db.run(
                "UPDATE requests SET status = 'in_progress' WHERE id = ?",
                [requestId],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);

                    afterBatchMutation(Number(driverId), Number(requestId), (mutErr) => {
                        if (mutErr) return callback(mutErr);
                        getRequestWithDriver(requestId, (getErr, ride) => {
                            if (getErr) return callback(getErr);
                            callback(null, {
                                ok: true,
                                message: "Passenger picked up. Follow the route to their destination.",
                                ride
                            });
                        });
                    });
                }
            );
        }
    );
}

function driverDropoffPassenger(driverId, requestId, callback) {
    db.get(
        "SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status = 'in_progress'",
        [requestId, driverId],
        (err, row) => {
            if (err) return callback(err);
            if (!row) {
                return callback(null, { ok: false, error: "Passenger is not in the vehicle for this ride." });
            }

            const dropLocation = row.destination || row.location;

            db.run(
                "UPDATE requests SET status = 'completed' WHERE id = ?",
                [requestId],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);

                    db.run(
                        "UPDATE drivers SET last_location = ? WHERE id = ?",
                        [dropLocation, driverId],
                        () => {
                            broadcast(requestId, Number(driverId));

                            countDriverBatchRides(db, Number(driverId), (countErr, remaining) => {
                                if (countErr) return callback(countErr);

                                if (remaining > 0) {
                                    afterBatchMutation(Number(driverId), Number(requestId), (mutErr) => {
                                        if (mutErr) return callback(mutErr);
                                        processWaitingQueue();
                                        getDriverBatchPayload(db, Number(driverId), (batchErr, batch) => {
                                            if (batchErr) return callback(batchErr);
                                            callback(null, {
                                                ok: true,
                                                message: "Passenger dropped off. Continue with your route.",
                                                batch,
                                                cleared: false
                                            });
                                        });
                                    });
                                    return;
                                }

                                freeDriverAndDispatch(driverId, (dispatchErr, dispatch) => {
                                    if (dispatchErr) return callback(dispatchErr);
                                    processWaitingQueue();
                                    callback(null, {
                                        ok: true,
                                        message: dispatch
                                            ? "Passenger dropped off. Next passenger added to your batch."
                                            : "Passenger dropped off. You are now available.",
                                        ride: dispatch
                                            ? { ...dispatch.request, status: "assigned" }
                                            : null,
                                        cleared: !dispatch,
                                        autoAssigned: !!dispatch
                                    });
                                });
                            });
                        }
                    );
                }
            );
        }
    );
}

function driverAcceptRide(driverId, requestId, callback) {
    driverPickupPassenger(driverId, requestId, callback);
}

function driverRejectRide(driverId, requestId, callback) {
    db.get(
        "SELECT * FROM requests WHERE id = ? AND driver_id = ?",
        [requestId, driverId],
        (err, row) => {
            if (err) return callback(err);
            if (!row) {
                return callback(null, { ok: false, error: "Ride not found for this driver." });
            }
            if (!ACTIVE_RIDE_STATUSES.includes(row.status)) {
                return callback(null, { ok: false, error: "Ride cannot be rejected now." });
            }

            if (row.status !== "assigned") {
                return callback(null, {
                    ok: false,
                    error: "Only passengers not yet picked up can be removed from your batch."
                });
            }

            db.run(
                "UPDATE requests SET status = 'waiting', driver_id = NULL, stop_order = NULL WHERE id = ?",
                [requestId],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);

                    broadcast(requestId, Number(driverId));

                    countDriverBatchRides(db, Number(driverId), (countErr, remaining) => {
                        if (countErr) return callback(countErr);

                        const finish = (dispatch) => {
                            processWaitingQueue();
                            callback(null, {
                                ok: true,
                                message: dispatch
                                    ? "Passenger removed. Another driver assigned from the queue."
                                    : remaining
                                      ? "Passenger removed from your batch. Route updated."
                                      : "Passenger returned to waiting queue.",
                                cleared: remaining === 0,
                                autoAssigned: !!dispatch
                            });
                        };

                        if (remaining > 0) {
                            afterBatchMutation(Number(driverId), Number(requestId), (mutErr) => {
                                if (mutErr) return callback(mutErr);
                                finish(null);
                            });
                            return;
                        }

                        freeDriverAndDispatch(
                            driverId,
                            (dispatchErr, dispatch) => {
                                if (dispatchErr) return callback(dispatchErr);
                                if (dispatch && dispatch.driver) {
                                    broadcast(dispatch.request.id, dispatch.driver.id);
                                }
                                finish(dispatch);
                            },
                            { excludeDriverId: Number(driverId), excludeRequestId: Number(requestId) }
                        );
                    });
                }
            );
        }
    );
}

function handleInboundDriverSms(phone, messageText, callback) {
    findAssignedRideByPhone(phone, (err, ride) => {
        if (err) return callback(err);
        if (!ride) {
            return callback(null, {
                ok: false,
                error: "No assigned ride waiting for your reply on this phone number."
            });
        }

        handleDriverReplyForRide(ride.driver_id, ride.id, messageText, callback);
    });
}

app.post("/webhooks/sms/inbound", (req, res) => {
    const inbound = parseInboundPayload(req.body);

    if (!inbound) {
        return res.status(400).json({ error: "Invalid inbound SMS payload." });
    }

    console.log("[SMS] Inbound from", inbound.phone, "→", inbound.message);

    handleInboundDriverSms(inbound.phone, inbound.message, (err, result) => {
        if (err) {
            console.error("[SMS] Inbound error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (!result.ok) {
            notifyDriverSmsResult(inbound.phone, `QueueGo: ${result.error}`);
            return res.status(400).json(result);
        }

        res.json(result);
    });
});

/**
 * Simulate driver SMS reply in demo mode (no Termii webhook needed).
 * POST /sms/simulate  { "phone": "08087654321", "message": "1" }
 */
app.post("/sms/simulate", (req, res) => {
    const { phone, message } = req.body;

    if (!phone || message === undefined) {
        return res.status(400).json({ error: "phone and message are required." });
    }

    handleInboundDriverSms(phone, message, (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(result);
    });
});

app.get("/driver/:driverId/batch", requireDriver, (req, res) => {
    const driverId = Number(req.params.driverId);

    getDriverBatchPayload(db, driverId, (err, batch) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(batch);
    });
});

app.get("/driver/:driverId/current-ride", requireDriver, (req, res) => {
    const driverId = req.params.driverId;

    getDriverBatchPayload(db, Number(driverId), (err, batch) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!batch.stops.length) {
            return res.json({ ride: null, batch, message: "No active passengers." });
        }
        const nextStop = batch.stops[0];
        const ride = batch.rides.find((row) => row.id === nextStop.requestId) || batch.rides[0];
        res.json({ ride, batch, nextStop });
    });
});

app.post("/driver/:driverId/pickup/:requestId", requireDriver, (req, res) => {
    const { driverId, requestId } = req.params;

    driverPickupPassenger(Number(driverId), Number(requestId), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json(result);
    });
});

app.post("/driver/:driverId/dropoff/:requestId", requireDriver, (req, res) => {
    const { driverId, requestId } = req.params;

    driverDropoffPassenger(Number(driverId), Number(requestId), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json(result);
    });
});

app.post("/driver/:driverId/accept/:requestId", requireDriver, (req, res) => {
    const { driverId, requestId } = req.params;

    driverPickupPassenger(Number(driverId), Number(requestId), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({
            message: result.message,
            ride: result.ride,
            cleared: false
        });
    });
});

app.post("/driver/:driverId/reject/:requestId", requireDriver, (req, res) => {
    const { driverId, requestId } = req.params;

    driverRejectRide(Number(driverId), Number(requestId), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({
            message: result.message,
            ride: null,
            cleared: result.cleared,
            autoAssigned: result.autoAssigned
        });
    });
});

app.post("/driver/:driverId/complete/:requestId", requireDriver, (req, res) => {
    const { driverId, requestId } = req.params;

    driverDropoffPassenger(Number(driverId), Number(requestId), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({
            message: result.message,
            ride: result.ride || null,
            batch: result.batch || null,
            cleared: result.cleared,
            autoAssigned: result.autoAssigned
        });
    });
});

app.post("/complete/:id", requireAdmin, (req, res) => {
    const id = req.params.id;

    db.get("SELECT driver_id, location FROM requests WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Request not found" });

        db.run("UPDATE requests SET status = 'completed' WHERE id = ?", [id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            if (row.driver_id && row.location) {
                db.run(
                    "UPDATE drivers SET last_location = ? WHERE id = ?",
                    [row.location, row.driver_id],
                    () => {}
                );
            }
            freeDriverAndDispatch(row.driver_id, (err3, dispatch) => {
                if (err3) return res.status(500).json({ error: err3.message });
                broadcast(id, row.driver_id);
                if (dispatch && dispatch.driver) {
                    broadcast(dispatch.request.id, dispatch.driver.id);
                }
                processWaitingQueue();
                res.json({ message: "Ride marked as completed." });
            });
        });
    });
});

app.post("/reject/:id", requireAdmin, (req, res) => {
    const id = req.params.id;

    db.get("SELECT driver_id FROM requests WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Request not found" });

        const driverId = row.driver_id;

        db.run(
            "UPDATE requests SET status = 'rejected', driver_id = NULL WHERE id = ?",
            [id],
            (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                freeDriverAndDispatch(driverId, (err3, dispatch) => {
                    if (err3) return res.status(500).json({ error: err3.message });
                    broadcast(id, driverId);
                    if (dispatch && dispatch.driver) {
                        broadcast(dispatch.request.id, dispatch.driver.id);
                    }
                    res.json({ message: "Ride rejected." });
                });
            }
        );
    });
});

app.post("/arriving/:id", requireAdmin, (req, res) => {
    const id = req.params.id;

    db.run(
        "UPDATE requests SET status = 'in_progress' WHERE id = ? AND status IN ('assigned', 'accepted', 'arriving')",
        [id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(400).json({ error: "Ride cannot be marked as in progress." });
            }
            broadcast(id, null);
            res.json({ message: "Ride marked as in progress." });
        }
    );
});

app.post("/reassign/:id", requireAdmin, (req, res) => {
    const id = req.params.id;

    db.get("SELECT * FROM requests WHERE id = ?", [id], (err, request) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!request) return res.status(404).json({ error: "Request not found" });

        if (request.status === "completed" || request.status === "rejected") {
            return res.status(400).json({ error: "Cannot reassign a finished ride." });
        }

        const oldDriverId = request.driver_id;

        freeDriver(oldDriverId, (freeErr) => {
            if (freeErr) return res.status(500).json({ error: freeErr.message });

            findAvailableDriver((findErr, driver) => {
                if (findErr) return res.status(500).json({ error: findErr.message });

                if (!driver) {
                    db.run(
                        "UPDATE requests SET status = 'waiting', driver_id = NULL WHERE id = ?",
                        [id],
                        (waitErr) => {
                            if (waitErr) return res.status(500).json({ error: waitErr.message });
                            broadcast(id, oldDriverId);
                            res.json({
                                message: "No drivers available. Passenger moved back to waiting.",
                                status: "waiting",
                                driver: null
                            });
                        }
                    );
                    return;
                }

                assignDriverToRequest(id, driver, (assignErr) => {
                    if (assignErr) return res.status(500).json({ error: assignErr.message });
                    broadcast(id, driver.id);
                    res.json({
                        message: "Driver reassigned successfully.",
                        status: "assigned",
                        driver: {
                            id: driver.id,
                            name: driver.name,
                            phone: driver.phone
                        }
                    });
                });
            });
        });
    });
});

const httpServer = http.createServer(app);
initRealtime(httpServer);

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Home:      http://localhost:${PORT}/`);
    console.log(`Passenger: http://localhost:${PORT}/passenger`);
    console.log(`Register:  http://localhost:${PORT}/passenger/register`);
    console.log(`Driver:    http://localhost:${PORT}/driver`);
    console.log(`Staff:     http://localhost:${PORT}/staff`);
    console.log(`Staff reg: http://localhost:${PORT}/staff/register`);
    const smsStatus = getSmsStatus(process.env.PUBLIC_URL || `http://localhost:${PORT}`);
    console.log(`SMS provider: ${smsStatus.provider}`);
    if (isTermiiMode()) {
        if (smsStatus.termiiConfigured) {
            console.log(`Termii sender: ${smsStatus.senderId} (channel: ${smsStatus.channel})`);
            if (smsStatus.inboundWebhookUrl) {
                console.log(`Termii inbound webhook → ${smsStatus.inboundWebhookUrl}`);
            }
        } else {
            console.warn("[SMS] SMS_PROVIDER=termii but TERMII_API_KEY is missing — falling back to console logs.");
        }
    } else if (isConsoleSmsMode()) {
        console.log("SMS demo mode — set SMS_PROVIDER=termii for real texts (see SMS_SETUP.md)");
    }
    console.log(`Wait threshold: ${WAIT_THRESHOLD_MINUTES} min (nearest-driver dispatch after this)`);

    setInterval(processWaitingQueue, 30000);

    if (isConsoleSmsMode()) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on("line", (line) => {
            const reply = line.trim();
            if (reply !== "1" && reply !== "0") {
                return;
            }

            const ctx = getLastConsoleAssign();
            if (!ctx) {
                console.log("[DEMO SMS] No ride waiting — submit a passenger request first.");
                return;
            }

            console.log(
                `[DEMO SMS] Driver reply: ${reply} (ride #${ctx.requestId} → ${ctx.driverName}, ${ctx.passengerName} @ ${ctx.pickup})`
            );

            handleDriverReplyForRide(ctx.driverId, ctx.requestId, reply, (err, result) => {
                if (err) {
                    console.error("[DEMO SMS] Error:", err.message);
                    return;
                }
                if (!result.ok) {
                    console.log("[DEMO SMS]", result.error);
                    return;
                }
                console.log("[DEMO SMS] OK:", result.message);
                if (result.action === "reject" && result.autoAssigned) {
                    console.log("[DEMO SMS] Passenger auto-reassigned to another available driver.\n");
                } else {
                    console.log("[DEMO SMS] Driver and passenger pages should update live via Socket.IO.\n");
                }
            });
        });
    }
});
