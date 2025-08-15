require('dotenv').config();
const Fastify = require('fastify');
const validator = require('validator');
const crypto = require('crypto');
const db = require('./database'); // Import the database

// Configuration from enviroment variables and their defaults
const port = process.env.PORT || 3000;
const inputCharLimit = parseInt(process.env.INPUT_CHAR_LIMIT, 10) || 100;
const interval = parseInt(process.env.EXPECTED_DELIVERY_INTERVAL_MINUTES, 10) || 30;

// Retrieves the salt from enviroment or crashes if there is no salt
const salt = process.env.HASH_SALT || undefined;
if (!salt) {
  throw new Error('HASH_SALT environment variable is not set. Stopping. Set HASH_SALT env variable to a random string.');
}

// Creates fastify with "rules" (hooks, plugins, registers, etc)
const fastify = Fastify({ logger: true });
// Register rate limiting to prevent abuse
// This will limit each IP to 3 requests every 30 minutes
fastify.register(require('@fastify/rate-limit'), {
  max: 3, // Max requests per IP
  timeWindow: '30 minutes', // Reset cooldown period
  allowList: [], // Add trusted IPs here if needed
  ban: interval - 1, // If the limit is exceeded, ban the IP for the interval minus one minute. This is to prevent issues with the ban length exactly matching the time window, which would cause the next valid heartbeat to be rejected.
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
  INSERT INTO heartbeats (hashId, version, browser, os, lastSeen)
  VALUES (@hashId, @version, @browser, @os, @lastSeen)
  ON CONFLICT(hashId) DO UPDATE SET
    version = excluded.version,
    browser = excluded.browser,
    os = excluded.os,
    lastSeen = excluded.lastSeen
`);

const writeQueue = [];
let isWriting = false;

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

setInterval(processQueue, 1); // Process the queue every millisecond

// Heartbeat endpoint
fastify.post('/heartbeat', async (request, reply) => {

  // Validate the request body
  const { id, version, browser, os } = request.body || {};
  if (!id || typeof id !== 'string') return reply.status(400).send({ error: 'Invalid ID' });
  if (id.length > inputCharLimit) return reply.status(400).send({ error: 'ID too long' });
  if (version && typeof version !== 'string') return reply.status(400).send({ error: 'Invalid version' });
  if (version.length > inputCharLimit) return reply.status(400).send({ error: 'Version too long' });
  if (browser && typeof browser !== 'string') return reply.status(400).send({ error: 'Invalid browser' });
  if (browser.length > inputCharLimit) return reply.status(400).send({ error: 'Browser too long' });
  if (os && typeof os !== 'string') return reply.status(400).send({ error: 'Invalid OS' });
  if (os.length > inputCharLimit) return reply.status(400).send({ error: 'OS too long' });

  // Sanitize inputs
  const safeId = validator.escape(id);
  const safeVersion = version ? validator.escape(version) : null;
  const safeBrowser = browser ? validator.escape(browser) : null;
  const safeOs = os ? validator.escape(os) : null;

  // Generate a unique hash for the userID so database leaks won't expose individual (PII) user traffic patterns
  const blobHashId = crypto.createHash('sha512').update(salt + safeId).digest();

  // This will allow us to track online users and their last seem time.
  const now = Date.now();
  writeQueue.push({
    hashId: blobHashId,
    version: safeVersion,
    browser: safeBrowser,
    os: safeOs,
    lastSeen: now
  });
  processQueue(); // Process the queue
  return { status: 'ok' };
});

// Hourly logging of online users (lastSeen within 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60*60*1000;
  const count = db.prepare('SELECT COUNT(*) AS c FROM heartbeats WHERE lastSeen > ?').get(oneHourAgo).c;
  console.log(`[${new Date().toISOString()}] Online users in last hour: ${count}`);
}, 60*60*1000);

// Start server
fastify.listen({ port: port, host: '0.0.0.0' })
  .then(() => console.log(`Telemetry server running on port ${port}`));
