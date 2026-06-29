const { hashPassword } = require("./auth");

function countRows(db, table, callback) {
    db.get(`SELECT COUNT(*) AS count FROM ${table}`, [], (err, row) => {
        if (err) return callback(err);
        callback(null, row ? row.count : 0);
    });
}

function parseDemoPassengers(raw) {
    if (!raw || !String(raw).trim()) {
        return [];
    }

    return String(raw)
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [name, email, password, phone] = entry.split(":").map((part) => part.trim());
            if (!name || !email || !password) {
                return null;
            }
            return {
                name,
                email: email.toLowerCase(),
                password,
                phone: phone || null
            };
        })
        .filter(Boolean);
}

function getDemoPassengersConfig() {
    const fromList = parseDemoPassengers(process.env.DEMO_PASSENGERS);
    const singleEmail = process.env.BOOTSTRAP_PASSENGER_EMAIL;
    const singlePassword = process.env.BOOTSTRAP_PASSENGER_PASSWORD;

    if (singleEmail && singlePassword) {
        fromList.push({
            name: process.env.BOOTSTRAP_PASSENGER_NAME || "Demo Passenger",
            email: String(singleEmail).trim().toLowerCase(),
            password: singlePassword,
            phone: process.env.BOOTSTRAP_PASSENGER_PHONE || null
        });
    }

    const seen = new Set();
    return fromList.filter((passenger) => {
        if (seen.has(passenger.email)) {
            return false;
        }
        seen.add(passenger.email);
        return true;
    });
}

function findDemoPassengerCredentials(email, password) {
    const normalizedEmail = String(email).trim().toLowerCase();
    return getDemoPassengersConfig().find(
        (passenger) =>
            passenger.email === normalizedEmail && String(passenger.password) === String(password)
    );
}

function upsertDemoPassenger(db, passenger, callback) {
    const passwordHash = hashPassword(passenger.password);

    db.get("SELECT * FROM passengers WHERE email = ?", [passenger.email], (lookupErr, existing) => {
        if (lookupErr) return callback(lookupErr);

        if (existing) {
            db.run(
                "UPDATE passengers SET name = ?, phone = ?, password_hash = ? WHERE id = ?",
                [passenger.name, passenger.phone, passwordHash, existing.id],
                (updateErr) => {
                    if (updateErr) return callback(updateErr);
                    callback(null, {
                        id: existing.id,
                        name: passenger.name,
                        email: passenger.email,
                        phone: passenger.phone
                    });
                }
            );
            return;
        }

        db.run(
            "INSERT INTO passengers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)",
            [passenger.name, passenger.email, passenger.phone, passwordHash],
            function (insertErr) {
                if (insertErr) return callback(insertErr);
                callback(null, {
                    id: this.lastID,
                    name: passenger.name,
                    email: passenger.email,
                    phone: passenger.phone
                });
            }
        );
    });
}

function ensureDemoPassengers(db, callback) {
    const demoPassengers = getDemoPassengersConfig();
    if (!demoPassengers.length) {
        return callback(null, { created: 0, updated: 0 });
    }

    let created = 0;
    let updated = 0;
    let index = 0;

    const next = () => {
        if (index >= demoPassengers.length) {
            if (created > 0 || updated > 0) {
                console.log(
                    `[Bootstrap] Demo passengers ready (${created} created, ${updated} updated).`
                );
            }
            return callback(null, { created, updated });
        }

        const passenger = demoPassengers[index++];
        db.get("SELECT id FROM passengers WHERE email = ?", [passenger.email], (err, row) => {
            if (err) return callback(err);

            upsertDemoPassenger(db, passenger, (upsertErr) => {
                if (upsertErr) return callback(upsertErr);
                if (row) {
                    updated += 1;
                } else {
                    created += 1;
                }
                next();
            });
        });
    };

    next();
}

function ensureDemoPassengerLogin(db, email, password, callback) {
    const demoPassenger = findDemoPassengerCredentials(email, password);
    if (!demoPassenger) {
        return callback(null, null);
    }

    upsertDemoPassenger(db, demoPassenger, (err, passenger) => {
        if (err) return callback(err);
        if (passenger) {
            console.log(`[Bootstrap] Passenger login restored: ${passenger.email}`);
        }
        callback(null, passenger);
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
        return callback(null, { created: 0, updated: 0 });
    }

    let created = 0;
    let updated = 0;
    let index = 0;

    const next = () => {
        if (index >= demoDrivers.length) {
            if (created > 0 || updated > 0) {
                console.log(
                    `[Bootstrap] Demo drivers ready (${created} created, ${updated} updated).`
                );
            }
            return callback(null, { created, updated });
        }

        const driver = demoDrivers[index++];
        db.get("SELECT id FROM drivers WHERE phone = ?", [driver.phone], (err, row) => {
            if (err) return callback(err);

            if (row) {
                db.run(
                    "UPDATE drivers SET name = ?, pin = ? WHERE id = ?",
                    [driver.name, driver.pin, row.id],
                    (updateErr) => {
                        if (updateErr) return callback(updateErr);
                        updated += 1;
                        next();
                    }
                );
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

        ensureDemoPassengers(db, (passengerErr, passengerResult) => {
            if (passengerErr) return callback(passengerErr);

            ensureDemoDrivers(db, (driverErr, driverResult) => {
                if (driverErr) return callback(driverErr);
                callback(null, {
                    admin: adminResult,
                    passengers: passengerResult,
                    drivers: driverResult
                });
            });
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
    parseDemoPassengers,
    getDemoPassengersConfig,
    ensureBootstrapAdminLogin,
    ensureDemoPassengerLogin,
    matchesBootstrapCredentials
};
