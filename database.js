const Database = require('better-sqlite3');
const db = new Database('telemetry.sqlite3');

// Create table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS heartbeats (
    hashId BLOB PRIMARY KEY,
    version TEXT CHECK (length(version) <= 100),
    browser TEXT CHECK (length(browser) <= 100),
    os TEXT CHECK (length(os) <= 100),
    lastSeen INTEGER
  )
`).run();

module.exports = db;
