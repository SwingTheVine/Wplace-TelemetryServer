require('dotenv').config();
const fs = require('fs');
const Fastify = require('fastify');
const validator = require('validator');
const db = require('./database'); // Import the database
const cron = require('node-cron');

// Configuration from enviroment variables and their defaults
const isDebug = process.env.DEBUG === 'true';
const port = process.env.PORT || 3000;
const fastifyPort = parseInt(process.env.FASTIFY_PORT, 10) || 3001; // Default to 3001 if not set
const inputCharLimit = parseInt(process.env.INPUT_CHAR_LIMIT, 10) || 100;
const intervalDelivery = parseInt(process.env.EXPECTED_DELIVERY_INTERVAL_MINUTES, 10) || 30; // Default to 30 minutes

// Creates fastify with "rules" (hooks, plugins, registers, etc)
const fastify = Fastify({
  logger: true,
  trustProxy: true,
  https: {
    key: fs.readFileSync(process.env.HTTPS_KEY_PATH || 'certs/privkey.pem'),
    cert: fs.readFileSync(process.env.HTTPS_CERT_PATH || 'certs/fullchain.pem'),
  }
});
// Register rate limiting to prevent abuse
// This will limit each IP to 3 requests every 30 minutes
fastify.register(require('@fastify/rate-limit'), {
  max: 3, // Max requests per IP
  timeWindow: `${intervalDelivery} minutes`, // Reset cooldown period
  bodyLimit: 1000, // Limit the size of the request body to 1000 bytes
  allowList: [], // Add trusted IPs here if needed
  ban: 3, // Ban the IP after the 2nd 429 response in the time window
}); // Ban time is in milliseconds, so we have to convert minutes to milliseconds
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

  if (isDebug) {console.log(`Received heartbeat from ${request.ip} or ${req.headers['x-forwarded-for']}:`, request.body);}

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

  if (isDebug) {
    console.log(`Aggregating from ${sourceTable} to ${targetTable} for interval ${new Date(startTime).toUTCString()} to ${new Date(endTime).toUTCString()}`);
    console.log(`Found ${rows.length} row${rows.length == 1 ? '' : 's'} to aggregate.`);
    console.log('Rows:', rows);
  }

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
    INSERT INTO ${targetTable} (${intervalStartCol}, onlineUsers, version, browser, os, lastSeen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(${intervalStartCol}) DO UPDATE SET
      onlineUsers = excluded.onlineUsers,
      version = excluded.version,
      browser = excluded.browser,
      os = excluded.os,
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

// Hourly
cron.schedule('0 * * * *', () => {
  console.log(`Hourly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 60 * 60 * 1000;
  aggregateTotals('heartbeats', 'totalsHourly', startTime, endTime, 'hourStart');
});

// Daily
cron.schedule('0 0 * * *', () => {
  console.log(`Daily job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 24 * 60 * 60 * 1000;
  aggregateTotals('totalsHourly', 'totalsDaily', startTime, endTime, 'dayStart');
});

// Weekly (Sunday midnight)
cron.schedule('0 0 * * 0', () => {
  console.log(`Weekly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  aggregateTotals('totalsDaily', 'totalsWeekly', startTime, endTime, 'weekStart');
});

// Monthly (1st of each month)
cron.schedule('0 0 1 * *', () => {
  console.log(`Monthly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const startTime = d.getTime();
  aggregateTotals('totalsWeekly', 'totalsMonthly', startTime, endTime, 'monthStart');
});

// Yearly (Jan 1st)
cron.schedule('0 0 1 1 *', () => {
  console.log(`Yearly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const startTime = d.getTime();
  aggregateTotals('totalsMonthly', 'totalsYearly', startTime, endTime, 'yearStart');
});

// Start server
fastify.listen({ port: fastifyPort, host: '0.0.0.0' })
  .then(() => console.log(`Fastify running on port ${fastifyPort}`));