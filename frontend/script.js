const form = document.getElementById("rideForm");
const message = document.getElementById("message");
const queueList = document.getElementById("queueList");
const driverList = document.getElementById("driverList");

// Submit ride request
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value;
    const location = document.getElementById("location").value;

    const response = await fetch("http://localhost:3000/request", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name,
            location
        })
    });

    const data = await response.json();

    message.textContent = data.message;

    loadQueue();
});

// Load queue
async function loadQueue() {

    const response = await fetch("http://localhost:3000/queue");
    const queue = await response.json();

    queueList.innerHTML = "";

    queue.forEach(passenger => {

        queueList.innerHTML += `
            <div class="card">
                <strong>Name:</strong> ${passenger.name}<br>
                <strong>Location:</strong> ${passenger.location}<br>
                <strong>Status:</strong> ${passenger.status}
            </div>
        `;
    });
}

// Load drivers
async function loadDrivers() {

    const response = await fetch("http://localhost:3000/drivers");
    const drivers = await response.json();

    driverList.innerHTML = "";

    drivers.forEach(driver => {

        driverList.innerHTML += `
            <div class="card">
                <strong>Name:</strong> ${driver.name}<br>
                <strong>Phone:</strong> ${driver.phone}<br>
                <strong>Status:</strong> ${driver.status}
            </div>
        `;
    });
}

// Load data when page opens
loadQueue();
loadDrivers();

setInterval(() => {
    loadQueue();
    loadDrivers();
}, 3000);