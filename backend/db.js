const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function resolveDatabasePath() {
    if (process.env.DATABASE_PATH) {
        return path.resolve(process.env.DATABASE_PATH);
    }
    return path.join(__dirname, "database.db");
}

function isPersistentDatabasePath(dbPath) {
    return Boolean(process.env.DATABASE_PATH);
}

function openDatabase() {
    const dbPath = resolveDatabasePath();
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    if (!isPersistentDatabasePath(dbPath)) {
        console.warn(
            "[DB] Using local SQLite file. On Render free tier, accounts reset after each deploy unless DATABASE_PATH points to a persistent disk."
        );
    } else {
        console.log(`[DB] Persistent SQLite path: ${dbPath}`);
    }

    return { db: new sqlite3.Database(dbPath), dbPath };
}

module.exports = {
    openDatabase,
    isPersistentDatabasePath,
    resolveDatabasePath
};
