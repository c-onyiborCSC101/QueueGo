const { hashPassword } = require("./auth");

function countRows(db, table, callback) {
    db.get(`SELECT COUNT(*) AS count FROM ${table}`, [], (err, row) => {
        if (err) return callback(err);
        callback(null, row ? row.count : 0);
    });
}

function parseDemoDrivers(raw) {
    if (!raw || !String(raw).trim()) {
        return [];
    }

    return String(raw)
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [name, phone, pin = "1234"] = entry.split(":").map((part) => part.trim());
            if (!name || !phone) {
                return null;
            }
            return { name, phone, pin };
        })
        .filter(Boolean);
}

function ensureBootstrapAdmin(db, callback) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const name = process.env.BOOTSTRAP_ADMIN_NAME || "Campus Operations";

    if (!email || !password) {
        return callback(null, { created: false, reason: "not_configured" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    db.get("SELECT id FROM admins WHERE email = ?", [normalizedEmail], (lookupErr, existing) => {
        if (lookupErr) return callback(lookupErr);

        if (existing) {
            db.run(
                "UPDATE admins SET name = ?, password_hash = ? WHERE id = ?",
                [name.trim(), passwordHash, existing.id],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);
                    callback(null, { created: false, updated: true, email: normalizedEmail });
                }
            );
            return;
        }

        countRows(db, "admins", (countErr, adminCount) => {
            if (countErr) return callback(countErr);

            if (adminCount > 0) {
                return callback(null, { created: false, reason: "other_admins_exist" });
            }

            db.run(
                "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
                [name.trim(), normalizedEmail, passwordHash],
                function (insertErr) {
                    if (insertErr) return callback(insertErr);
                    console.log(`[Bootstrap] Staff account ready: ${normalizedEmail}`);
                    callback(null, { created: true, email: normalizedEmail, id: this.lastID });
                }
            );
        });
    });
}

function ensureDemoDrivers(db, callback) {
    const demoDrivers = parseDemoDrivers(process.env.DEMO_DRIVERS);
    if (!demoDrivers.length) {
        return callback(null, { created: 0 });
    }

    let created = 0;
    let index = 0;

    const next = () => {
        if (index >= demoDrivers.length) {
            if (created > 0) {
                console.log(`[Bootstrap] Restored ${created} demo driver(s) from DEMO_DRIVERS.`);
            }
            return callback(null, { created });
        }

        const driver = demoDrivers[index++];
        db.get("SELECT id FROM drivers WHERE phone = ?", [driver.phone], (err, row) => {
            if (err) return callback(err);

            if (row) {
                next();
                return;
            }

            db.run(
                "INSERT INTO drivers (name, phone, pin) VALUES (?, ?, ?)",
                [driver.name, driver.phone, driver.pin],
                (insertErr) => {
                    if (insertErr) return callback(insertErr);
                    created += 1;
                    next();
                }
            );
        });
    };

    next();
}

function runBootstrap(db, callback) {
    ensureBootstrapAdmin(db, (adminErr, adminResult) => {
        if (adminErr) return callback(adminErr);

        ensureDemoDrivers(db, (driverErr, driverResult) => {
            if (driverErr) return callback(driverErr);
            callback(null, { admin: adminResult, drivers: driverResult });
        });
    });
}

function matchesBootstrapCredentials(email, password) {
    const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!bootstrapEmail || !bootstrapPassword) {
        return false;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const expectedEmail = String(bootstrapEmail).trim().toLowerCase();

    return normalizedEmail === expectedEmail && String(password) === String(bootstrapPassword);
}

function ensureBootstrapAdminLogin(db, email, password, callback) {
    if (!matchesBootstrapCredentials(email, password)) {
        return callback(null, null);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const name = process.env.BOOTSTRAP_ADMIN_NAME || "Campus Operations";
    const passwordHash = hashPassword(password);

    db.get("SELECT * FROM admins WHERE email = ?", [normalizedEmail], (lookupErr, existing) => {
        if (lookupErr) return callback(lookupErr);

        if (existing) {
            db.run(
                "UPDATE admins SET name = ?, password_hash = ? WHERE id = ?",
                [name.trim(), passwordHash, existing.id],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);
                    callback(null, {
                        id: existing.id,
                        name: name.trim(),
                        email: normalizedEmail
                    });
                }
            );
            return;
        }

        db.run(
            "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
            [name.trim(), normalizedEmail, passwordHash],
            function (insertErr) {
                if (insertErr) return callback(insertErr);
                console.log(`[Bootstrap] Staff account created on login: ${normalizedEmail}`);
                callback(null, {
                    id: this.lastID,
                    name: name.trim(),
                    email: normalizedEmail
                });
            }
        );
    });
}

module.exports = {
    runBootstrap,
    countRows,
    parseDemoDrivers,
    ensureBootstrapAdminLogin,
    matchesBootstrapCredentials
};
