const Database = require('better-sqlite3');
const db = new Database('telemetry.sqlite3');

// Create recent heartbeat table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS heartbeats ( -- Create the table to store recent heartbeats
    uuid TEXT PRIMARY KEY CHECK (length(uuid) <= 100), -- Unique user identifier
    version TEXT CHECK (length(version) <= 100), -- Version of Blue Marble
    browser TEXT CHECK (length(browser) <= 100), -- Browser name
    os TEXT CHECK (length(os) <= 100), -- OS name
    lastSeen INTEGER -- Timestamp of last heartbeat (Unix Timestamp)
  )
`).run();

// Creates totals table for hours if it doesn't exist
// If the server restarts, the hours won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsHourly ( -- Create the table to store hourly totals
    hourStart INTEGER PRIMARY KEY, -- Start of the hour (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that hour
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of last hour (Unix Timestamp)
  )
`).run();

// Creates totals table for days if it doesn't exist
// If the server restarts, the days won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsDaily ( -- Create the table to store daily totals
    dayStart INTEGER PRIMARY KEY, -- Start of the day (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that day
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of last day (Unix Timestamp)
  )
`).run();

// Creates totals table for weeks if it doesn't exist
// If the server restarts, the weeks won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsWeekly ( -- Create the table to store weekly totals
    weekStart INTEGER PRIMARY KEY, -- Start of the week (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that week
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of last week (Unix Timestamp)
  )
`).run();

// Creates totals table for months if it doesn't exist
// If the server restarts, the months won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsMonthly ( -- Create the table to store months totals
    monthStart INTEGER PRIMARY KEY, -- Start of the month (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that month
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of last month (Unix Timestamp)
  )
`).run();

// Creates totals table for years if it doesn't exist
// If the server restarts, the years won't be spaced evenly
db.prepare(`
  CREATE TABLE IF NOT EXISTS totalsYearly ( -- Create the table to store years totals
    yearStart INTEGER PRIMARY KEY, -- Start of the year (unix timestamp)
    onlineUsers INTEGER, -- Number of online users in that year
    version TEXT, -- JSON string of version totals: {"1.0.0": 10, "1.1.0": 4, ...}
    browser TEXT, -- JSON string of browser totals: {"Chrome": 10, "Firefox": 7, ...}
    os TEXT, -- JSON string of OS totals: {"Windows": 1343, "Linux": 1, ...}
    lastSeen INTEGER -- Timestamp of last year (Unix Timestamp)
  )
`).run();

// Creates the indexes for lastSeen to make queries faster
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeen ON heartbeats(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenHourly ON totalsHourly(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenDaily ON totalsDaily(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenWeekly ON totalsWeekly(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenMonthly ON totalsMonthly(lastSeen)
`).run();
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_lastSeenYearly ON totalsYearly(lastSeen)
`).run();

module.exports = db;
