require('dotenv').config();
const Fastify = require('fastify');
const validator = require('validator');
const db = require('./database'); // Import the database

// Configuration from enviroment variables and their defaults
const port = process.env.PORT || 3000;
const inputCharLimit = parseInt(process.env.INPUT_CHAR_LIMIT, 10) || 100;
const intervalDelivery = parseInt(process.env.EXPECTED_DELIVERY_INTERVAL_MINUTES, 10) || 30; // Default to 30 minutes
const intervalLogging = parseInt(process.env.EXPECTED_LOGGING_INTERVAL_MINUTES, 10) * 60 * 1000 || 60 * 60 * 1000; // Default to 1 hour

// Creates fastify with "rules" (hooks, plugins, registers, etc)
const fastify = Fastify({ logger: true });
// Register rate limiting to prevent abuse
// This will limit each IP to 3 requests every 30 minutes
fastify.register(require('@fastify/rate-limit'), {
  max: 3, // Max requests per IP
  timeWindow: '30 minutes', // Reset cooldown period
  allowList: [], // Add trusted IPs here if needed
  ban: intervalDelivery - 1, // If the limit is exceeded, ban the IP for the interval minus one minute. This is to prevent issues with the ban length exactly matching the time window, which would cause the next valid heartbeat to be rejected.
});
// Log when an IP exceeds the rate limit
fastify.addHook('onSend', async (request, reply, payload) => {
  if (reply.statusCode === 429) {
    console.warn(`IP ${request.ip} exceeded rate limit`);
  }
  return payload;
});

// Tells processQueue *how* to write/override to the database
const statement = db.prepare(`
  INSERT INTO heartbeats (uuid, version, browser, os, lastSeen)
  VALUES (@uuid, @version, @browser, @os, @lastSeen)
  ON CONFLICT(uuid) DO UPDATE SET
    version = excluded.version,
    browser = excluded.browser,
    os = excluded.os,
    lastSeen = excluded.lastSeen
`);

const writeQueue = []; // A queue of writes to be processed
let isWriting = false; // Are we currently writing to the database?

// Runs through the write queue and writes to the database
async function processQueue() {

  // If we are currently writing, or the queue is empty, return early
  if (isWriting || writeQueue.length === 0) return;

  isWriting = true; // We are now writing whatever is in the queue

  const task = writeQueue.shift(); // pop() but for the first index of the array

  // Attempts to write to the database
  try {
    statement.run(task);
  } catch (exception) {
    console.error('Database write error:', exception);
  }

  isWriting = false; // We are done writing
}

// Attempt to process the queue every X milliseconds
// Or in other words, the queue is always being processed, and the queue unblocks the thread every X miliseconds
setInterval(processQueue, 10);

// Heartbeat endpoint
fastify.post('/heartbeat', async (request, reply) => {

  // Validate the request body
  const { uuid, version, browser, os } = request.body || {};
  if (!uuid || typeof uuid !== 'string') return reply.status(400).send({ error: 'Invalid UUID' });
  if (uuid.length > inputCharLimit) return reply.status(400).send({ error: 'UUID too long' });
  if (version && typeof version !== 'string') return reply.status(400).send({ error: 'Invalid version' });
  if (version.length > inputCharLimit) return reply.status(400).send({ error: 'Version too long' });
  if (browser && typeof browser !== 'string') return reply.status(400).send({ error: 'Invalid browser' });
  if (browser.length > inputCharLimit) return reply.status(400).send({ error: 'Browser too long' });
  if (os && typeof os !== 'string') return reply.status(400).send({ error: 'Invalid OS' });
  if (os.length > inputCharLimit) return reply.status(400).send({ error: 'OS too long' });

  // Sanitize inputs
  const safeUuid = validator.escape(uuid);
  const safeVersion = version ? validator.escape(version) : null;
  const safeBrowser = browser ? validator.escape(browser) : null;
  const safeOs = os ? validator.escape(os) : null;

  // This will allow us to track online users and their last seem time.
  const now = Date.now();
  writeQueue.push({
    uuid: safeUuid,
    version: safeVersion,
    browser: safeBrowser,
    os: safeOs,
    lastSeen: now
  });
  
  return { status: 'ok' };
});

/**
 * Generic aggregator
 * @param {string} sourceTable - raw table (e.g., 'heartbeats')
 * @param {string} targetTable - totals table (e.g., 'totalsHourly')
 * @param {number} startTime - start of interval (Unix timestamp in ms)
 * @param {number} endTime - end of interval
 * @param {string} intervalStartCol - column name in target table for start timestamp
 */
function aggregateTotals(sourceTable, targetTable, startTime, endTime, intervalStartCol) {
  const rows = db.prepare(`
    SELECT version, browser, os
    FROM ${sourceTable}
    WHERE lastSeen >= ? AND lastSeen < ?
  `).all(startTime, endTime);

  const versionTotals = {};
  const browserTotals = {};
  const osTotals = {};
  const onlineUsers = rows.length;

  for (const row of rows) {
    if (row.version) versionTotals[row.version] = (versionTotals[row.version] || 0) + 1;
    if (row.browser) browserTotals[row.browser] = (browserTotals[row.browser] || 0) + 1;
    if (row.os) osTotals[row.os] = (osTotals[row.os] || 0) + 1;
  }

  // Store totals in the tageted table
  db.prepare(`
    INSERT INTO ${targetTable} (${intervalStartCol}, onlineUsers, versionTotals, browserTotals, osTotals, lastSeen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(${intervalStartCol}) DO UPDATE SET
      onlineUsers = excluded.onlineUsers,
      versionTotals = excluded.versionTotals,
      browserTotals = excluded.browserTotals,
      osTotals = excluded.osTotals,
      lastSeen = excluded.lastSeen
  `).run(
    startTime,
    onlineUsers,
    JSON.stringify(versionTotals),
    JSON.stringify(browserTotals),
    JSON.stringify(osTotals),
    endTime
  );

  // Delete aggregated raw data
  db.prepare(`
    DELETE FROM ${sourceTable}
    WHERE lastSeen >= ? AND lastSeen < ?
  `).run(startTime, endTime);
}

setTimeout(() => {

  setInterval(() => {
    const endTime = Date.now();
    const startTime = endTime - 60 * 60 * 1000; // 1 hour ago;
    aggregateTotals('heartbeats', 'totalsHourly', startTime, endTime, 'hourStart')
  }, 60 * 60 * 1000);
}, msUntilNextHour());

setTimeout(() => {

  setInterval(() => {
    const endTime = Date.now();
    const previousDay = endTime - 24 * 60 * 60 * 1000; // 1 day ago
    aggregateTotals('totalsHourly', 'totalsDaily', previousDay, endTime, 'dayStart')
  }, 24 * 60 * 60 * 1000);
}, msUntilNextDay());

setTimeout(() => {

  setInterval(() => {
    const endTime = Date.now();
    const previousWeek = endTime - 7 * 24 * 60 * 60 * 1000; // 1 week ago
    aggregateTotals('totalsDaily', 'totalsWeekly', previousWeek, now, 'weekStart')
  }, 7 * 24 * 60 * 60 * 1000);
}, msUntilNextWeek());

setTimeout(() => {

  setInterval(() => {
    const endTime = Date.now();
    const previousMonth = endTime - 30 * 24 * 60 * 60 * 1000; // 1 month ago
    aggregateTotals('totalsWeekly', 'totalsMonthly', previousMonth, now, 'monthStart')
  }, 30 * 24 * 60 * 60 * 1000);
});

setTimeout(() => {

  setInterval(() => {
    const endTime = Date.now();
    const previousYear = endTime - 365 * 24 * 60 * 60 * 1000; // 1 year ago
    aggregateTotals('totalsMonthly', 'totalsYearly', previousYear, now, 'yearStart')
  }, 365 * 24 * 60 * 60 * 1000);
});

function msUntilNextHour() {
  const now = new Date();
  return ((60 - now.getMinutes() - 1) * 60 * 1000) + ((60 - now.getSeconds() - 1) * 1000) + (1000 - now.getMilliseconds());
}

function msUntilNextDay() {
  const now = new Date();
  return ((24 - now.getHours() - 1) * 60 * 60 * 1000) + ((60 - now.getMinutes() - 1) * 60 * 1000) + ((60 - now.getSeconds() - 1) * 1000) + (1000 - now.getMilliseconds());
}

function msUntilNextWeek() {
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7;
  return (daysUntilSunday * 24 * 60 * 60 * 1000) + ((24 - now.getHours() - 1) * 60 * 60 * 1000) + ((60 - now.getMinutes() - 1) * 60 * 1000) + ((60 - now.getSeconds() - 1) * 1000) + (1000 - now.getMilliseconds());
}

function msUntilNextMonth() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth - now;
}

function msUntilNextYear() {
  const now = new Date();
  const nextYear = new Date(now.getFullYear() + 1, 0, 1);
  return nextYear - now;
}

// Start server
fastify.listen({ port: port, host: '0.0.0.0' })
  .then(() => console.log(`Telemetry server running on port ${port}`));