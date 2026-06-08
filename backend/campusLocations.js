/**
 * Campus pickup coordinates (relative map units) for dispatch distance estimates.
 * Used to pick the nearest available driver when wait thresholds are exceeded.
 */
const CAMPUS_POINTS = {
    "EDC": { x: 2, y: 8 },
    "POD": { x: 4, y: 7 },
    "COOP MALES": { x: 6, y: 5 },
    "COOP FEMALES": { x: 7, y: 4 },
    "SST": { x: 7, y: 7 },
    "STUDENT CENTER": { x: 5, y: 5 },
    "FAITH": { x: 3, y: 3 },
    "AMETHYST": { x: 8, y: 6 },
    "ASTERHALL": { x: 9, y: 3 },
    "EMERALD": { x: 9, y: 5 },
    "ELEKO": { x: 4, y: 1 },
    "CEDAR": { x: 1, y: 6 },
    "TRINITY": { x: 2, y: 4 },
    "PEARL": { x: 10, y: 4 },
    "QUEEN MARY HOSTEL": { x: 0, y: 2 },
    "REDWOOD": { x: 11, y: 7 },
    "TREZADEL": { x: 8, y: 2 },
    "TYD": { x: 3, y: 7 },
    "CLINIC": { x: 4, y: 2 },
    "MAMA PUTH": { x: 6, y: 8 },
    "SCHOOL GATE": { x: 5, y: 0 }
};

const DEFAULT_HUB = "STUDENT CENTER";

function getPoint(location) {
    if (!location) return CAMPUS_POINTS[DEFAULT_HUB];
    const key = String(location).trim().toUpperCase();
    return CAMPUS_POINTS[key] || CAMPUS_POINTS[DEFAULT_HUB];
}

function distanceUnits(fromLocation, toLocation) {
    const a = getPoint(fromLocation);
    const b = getPoint(toLocation);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Rough campus travel minutes between two pickup points. */
function estimateMinutes(fromLocation, toLocation) {
    return Math.max(1, Math.round(distanceUnits(fromLocation, toLocation) * 2));
}

function getLocationList() {
    return Object.keys(CAMPUS_POINTS).sort();
}

module.exports = {
    CAMPUS_POINTS,
    DEFAULT_HUB,
    getPoint,
    distanceUnits,
    estimateMinutes,
    getLocationList
};
