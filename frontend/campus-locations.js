const CAMPUS_LOCATIONS = [
    "AMETHYST",
    "ASTERHALL",
    "CEDAR",
    "CLINIC",
    "COOP FEMALES",
    "COOP MALES",
    "EDC",
    "ELEKO",
    "EMERALD",
    "FAITH",
    "MAMA PUTH",
    "PEARL",
    "POD",
    "QUEEN MARY HOSTEL",
    "REDWOOD",
    "SCHOOL GATE",
    "SST",
    "STUDENT CENTER",
    "TREZADEL",
    "TRINITY",
    "TYD"
];

function fillCampusLocationSelect(selectEl, emptyLabel) {
    if (!selectEl) return;

    selectEl.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel || "— Select —";
    selectEl.appendChild(empty);

    CAMPUS_LOCATIONS.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        selectEl.appendChild(opt);
    });
}
