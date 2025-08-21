const Database = require('better-sqlite3');
const db = new Database('telemetry.sqlite3');

// Create recent heartbeat table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS heartbeats ( -- Create the table to store recent heartbeats
    uuid TEXT PRIMARY KEY CHECK (length(uuid) <= 100), -- Unique user identifier
    version TEXT CHECK (length(version) <= 100), -- Version of Blue Marble
    browser TEXT CHECK (length(browser) <= 100), -- Browser name
    os TEXT CHECK (length(os) <= 100), -- OS name
    lastSeen INTEGER, -- Timestamp of last heartbeat (Unix Timestamp)
    rollingAvgOnlineUsers INTEGER -- Rolling average of online users
  )
`).run();

try {
  db.prepare('ALTER TABLE totalsHourly ADD COLUMN rollingAvgOnlineUsers INTEGER DEFAULT NULL').run();
  console.log('Column added.');
} catch (err) {
  if (err.message.includes('duplicate column name')) {
    console.log('Column rollingAvgOnlineUsers already exists.');
  } else {
    throw err;
  }
}

// Creates totals table for hours if it doesn't exist
// If the server restarts, the hours won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsHourly ( -- Create the table to store hourly totals
    hourStart INTEGER PRIMARY KEY, -- Start of the hour (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that hour
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of end of hour (Unix Timestamp)
  )
`).run();

db.prepare('DROP TABLE IF EXISTS totalsDaily').run();
db.prepare('DROP TABLE IF EXISTS totalsWeekly').run();
db.prepare('DROP TABLE IF EXISTS totalsMonthly').run();
db.prepare('DROP TABLE IF EXISTS totalsYearly').run();

// Creates the indexes for lastSeen to make queries faster
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeen ON heartbeats(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenHourly ON totalsHourly(lastSeen)
`).run();

module.exports = db;
