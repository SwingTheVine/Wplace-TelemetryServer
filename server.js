require('dotenv').config();
const Fastify = require('fastify');
const Redis = require('ioredis');
const validator = require('validator');
const crypto = require('crypto');

// Configuration from enviroment variables and their defaults
const port = process.env.PORT || 3000;
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env.REDIS_PORT || 6379;
const inputCharLimit = parseInt(process.env.INPUT_CHAR_LIMIT, 10) || 100;

const salt = process.env.HASH_SALT || undefined; // Retrieves the salt from enviroment
// Crash on no salt
if (!salt) {
  throw new Error('HASH_SALT environment variable is not set. Stopping. Set HASH_SALT env variable to a random string.');
}

const fastify = Fastify({ logger: true });
const redis = new Redis({ host: redisHost, port: redisPort });

// Redis error handling
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', err => console.error('Redis error:', err));

// Register rate limiting to prevent abuse
// This will limit each IP to 3 requests every 30 minutes
fastify.register(require('@fastify/rate-limit'), {
  max: 3, // max 10 requests per IP
  timeWindow: '30 minutes', // Reset every 30 minutes
  redis
});

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
  const hashId = crypto.createHash('sha512').update(salt + safeId).digest('hex');
  const base64Id = Buffer.from(hashId, 'hex').toString('base64');

  // Store the heartbeat in Redis with a 2-hour lifetime.
  // This will allow us to track online users and their last seem time.
  const now = Date.now();
  await redis.set(base64Id, JSON.stringify({ safeVersion, safeBrowser, safeOs, lastSeen: now }), 'EX', 3600); // 1-hour TTL in seconds
  return { status: 'ok' };
});

// Hourly logging
setInterval(async () => {

  // Attempt to scan the Redis database for online users.
  // This will count the number of unique user ID hashes stored in Redis.
  // This forces Redis to return at MOST 100 keys per scan before unblocking the thread.
  // If there are more than 100 keys, it will continue scanning shortly after unblocking the thread.
  // Otherwise, Redis would block the thread until all keys are returned, which could take a long time
  try {
    let cursor = '0';
    let count = 0;
    do {
      // Use COUNT to limit keys returned per scan
      const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', 100);
      count += keys.length;
      cursor = nextCursor;
    } while (cursor !== '0');

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Online users: ${count}`);
  } catch (err) {
    console.error('Error scanning Redis:', err);
  }
}, 60 * 60 * 1000);

// Start server
fastify.listen({ port: port, host: '0.0.0.0' })
  .then(() => console.log(`Telemetry server running on port ${port}`));
