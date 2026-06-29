const { Server } = require("socket.io");

let io = null;

function initRealtime(httpServer) {
    io = new Server(httpServer, {
        cors: { origin: "*" }
    });

    io.on("connection", (socket) => {
        socket.on("join:ride", (requestId) => {
            if (requestId) socket.join(`ride:${requestId}`);
        });

        socket.on("join:driver", (driverId) => {
            if (driverId) socket.join(`driver:${driverId}`);
        });

        socket.on("join:admin", () => {
            socket.join("admin");
        });
    });

    return io;
}

function emitDriversUpdated() {
    if (io) io.emit("drivers:updated");
}

function emitRidesUpdated() {
    if (io) io.emit("rides:updated");
}

function emitRideStatus(requestId, ride) {
    if (!io) return;
    if (ride) {
        io.to(`ride:${requestId}`).emit("ride:status", ride);
    }
    emitRidesUpdated();
}

function emitDriverUpdated(driverId) {
    if (!io) {
        return;
    }
    io.to(`driver:${driverId}`).emit("driver:updated");
    emitRidesUpdated();
}

function notifyRideChange(getRequestWithDriver, requestId, driverId) {
    if (requestId) {
        getRequestWithDriver(requestId, (err, row) => {
            if (!err && row) {
                emitRideStatus(requestId, row);
            } else {
                emitRidesUpdated();
            }
        });
    } else {
        emitRidesUpdated();
    }

    if (driverId) {
        emitDriverUpdated(driverId);
    }
}

module.exports = {
    initRealtime,
    emitRidesUpdated,
    emitRideStatus,
    emitDriverUpdated,
    emitDriversUpdated,
    notifyRideChange
};
