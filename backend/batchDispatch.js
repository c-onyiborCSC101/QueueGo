const { distanceUnits, DEFAULT_HUB } = require("./campusLocations");

const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || 4);
const BATCH_ACTIVE_STATUSES = ["assigned", "in_progress"];

function nearestNeighborOrder(items, getLocation, startLocation) {
    const remaining = [...items];
    const ordered = [];
    let cursor = startLocation || DEFAULT_HUB;

    while (remaining.length) {
        let bestIndex = 0;
        let bestDistance = Infinity;

        remaining.forEach((item, index) => {
            const dist = distanceUnits(cursor, getLocation(item));
            if (dist < bestDistance) {
                bestDistance = dist;
                bestIndex = index;
            }
        });

        const next = remaining.splice(bestIndex, 1)[0];
        ordered.push(next);
        cursor = getLocation(next);
    }

    return ordered;
}

function getDriverOrigin(driver, batchRides) {
    if (driver.last_location) {
        return driver.last_location;
    }

    const inVehicle = batchRides.filter((ride) => ride.status === "in_progress");
    if (inVehicle.length) {
        return inVehicle[0].location;
    }

    return DEFAULT_HUB;
}

function buildOptimizedStops(batchRides, driver) {
    const pickups = batchRides.filter((ride) => ride.status === "assigned");
    const dropoffs = batchRides.filter((ride) => ride.status === "in_progress");
    const origin = getDriverOrigin(driver, batchRides);

    const orderedPickups = nearestNeighborOrder(pickups, (ride) => ride.location, origin);
    const dropoffStart = orderedPickups.length
        ? orderedPickups[orderedPickups.length - 1].location
        : origin;
    const orderedDropoffs = nearestNeighborOrder(
        dropoffs,
        (ride) => ride.destination || ride.location,
        dropoffStart
    );

    const stops = [];

    orderedPickups.forEach((ride, index) => {
        stops.push({
            requestId: ride.id,
            stopOrder: index + 1,
            stopType: "pickup",
            campusLocation: ride.location
        });
    });

    orderedDropoffs.forEach((ride, index) => {
        stops.push({
            requestId: ride.id,
            stopOrder: orderedPickups.length + index + 1,
            stopType: "dropoff",
            campusLocation: ride.destination || ride.location
        });
    });

    return stops;
}

function getDriverBatchRides(db, driverId, callback) {
    const placeholders = BATCH_ACTIVE_STATUSES.map(() => "?").join(", ");
    db.all(
        `SELECT * FROM requests
         WHERE driver_id = ? AND status IN (${placeholders})
         ORDER BY COALESCE(stop_order, 999), timestamp ASC`,
        [driverId, ...BATCH_ACTIVE_STATUSES],
        callback
    );
}

function countDriverBatchRides(db, driverId, callback) {
    getDriverBatchRides(db, driverId, (err, rides) => {
        if (err) return callback(err);
        callback(null, rides.length);
    });
}

function optimizeDriverBatch(db, driverId, callback) {
    db.get("SELECT * FROM drivers WHERE id = ?", [driverId], (driverErr, driver) => {
        if (driverErr) return callback(driverErr);
        if (!driver) return callback(new Error("Driver not found."));

        getDriverBatchRides(db, driverId, (batchErr, batchRides) => {
            if (batchErr) return callback(batchErr);

            const stops = buildOptimizedStops(batchRides, driver);

            db.serialize(() => {
                batchRides.forEach((ride) => {
                    db.run("UPDATE requests SET stop_order = NULL WHERE id = ?", [ride.id]);
                });

                stops.forEach((stop) => {
                    db.run("UPDATE requests SET stop_order = ? WHERE id = ?", [
                        stop.stopOrder,
                        stop.requestId
                    ]);
                });

                callback(null, { driver, batchRides, stops });
            });
        });
    });
}

function findDriverForNewRequest(db, pickupLocation, excludeDriverId, callback) {
    db.all("SELECT * FROM drivers", [], (err, drivers) => {
        if (err) return callback(err);

        const candidates = drivers.filter(
            (driver) => !excludeDriverId || Number(driver.id) !== Number(excludeDriverId)
        );

        const evaluateDriver = (driver, done) => {
            getDriverBatchRides(db, driver.id, (batchErr, batchRides) => {
                if (batchErr) return done(batchErr);

                const batchCount = batchRides.length;
                const isAvailable = driver.status === "available" && batchCount === 0;
                const hasBatchRoom =
                    batchCount > 0 && batchCount < MAX_BATCH_SIZE;

                if (!isAvailable && !hasBatchRoom) {
                    return done(null, null);
                }

                const origin = getDriverOrigin(driver, batchRides);
                const score = distanceUnits(origin, pickupLocation);
                done(null, { driver, score, batchCount, isAvailable });
            });
        };

        const results = [];
        let pending = candidates.length;

        if (!pending) {
            return callback(null, null);
        }

        candidates.forEach((driver) => {
            evaluateDriver(driver, (evalErr, result) => {
                if (evalErr) return callback(evalErr);
                if (result) results.push(result);
                pending -= 1;
                if (pending === 0) {
                    if (!results.length) return callback(null, null);

                    results.sort((a, b) => {
                        if (a.isAvailable !== b.isAvailable) {
                            return a.isAvailable ? -1 : 1;
                        }
                        return a.score - b.score;
                    });

                    callback(null, results[0].driver);
                }
            });
        });
    });
}

function formatBatchStop(ride) {
    const stopType = ride.status === "assigned" ? "pickup" : "dropoff";
    return {
        requestId: ride.id,
        passengerName: ride.name,
        pickup: ride.location,
        destination: ride.destination || ride.location,
        status: ride.status,
        stopType,
        stopOrder: ride.stop_order,
        campusLocation: stopType === "pickup" ? ride.location : ride.destination || ride.location
    };
}

function getDriverBatchPayload(db, driverId, callback) {
    getDriverBatchRides(db, driverId, (err, rides) => {
        if (err) return callback(err);

        const stops = rides
            .map(formatBatchStop)
            .sort((a, b) => (a.stopOrder || 999) - (b.stopOrder || 999));

        callback(null, {
            batchSize: rides.length,
            maxBatchSize: MAX_BATCH_SIZE,
            stops,
            rides
        });
    });
}

module.exports = {
    MAX_BATCH_SIZE,
    BATCH_ACTIVE_STATUSES,
    nearestNeighborOrder,
    optimizeDriverBatch,
    findDriverForNewRequest,
    getDriverBatchRides,
    countDriverBatchRides,
    getDriverBatchPayload,
    formatBatchStop
};
