console.log("Starting node server...");
require('dotenv').config();
const fs = require('fs');
const Fastify = require('fastify');
const validator = require('validator');
const db = require('./database'); // Import the database
const cron = require('node-cron');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Configuration from enviroment variables and their defaults
const isDebug = process.env.DEBUG === 'true';
const port = process.env.PORT || 3000;
const fastifyPort = parseInt(process.env.FASTIFY_PORT, 10) || 3001; // Default to 3001 if not set
const inputCharLimit = parseInt(process.env.INPUT_CHAR_LIMIT, 10) || 100;
const intervalDelivery = parseInt(process.env.EXPECTED_DELIVERY_INTERVAL_MINUTES, 10) || 30; // Default to 30 minutes

// Creates fastify with "rules" (hooks, plugins, registers, etc)
const fastify = Fastify({
  logger: isDebug ? { level: 'debug' } : false,
  // https: {
  //   key: fs.readFileSync(process.env.HTTPS_KEY_PATH || 'certs/privkey.pem'),
  //   cert: fs.readFileSync(process.env.HTTPS_CERT_PATH || 'certs/fullchain.pem'),
  // }
});
// Register rate limiting to prevent abuse
// This will limit each IP to 3 requests every 30 minutes
fastify.register(require('@fastify/rate-limit'), {
  max: 3, // Max requests per IP
  timeWindow: `${intervalDelivery} minutes`, // Reset cooldown period
  bodyLimit: 1000, // Limit the size of the request body to 1000 bytes
  allowList: [], // Add trusted IPs here if needed
  ban: 3, // Ban the IP after the 2nd 429 response in the time window
  keyGenerator: (request) => {
    const ip = request.headers['x-real-ip'] // nginx
    || request.headers['x-client-ip'] // apache
    || request.headers['x-forwarded-for'] // use this only if you trust the header
    || request.ip // fallback to default
    return ip;
  }
}); // Ban time is in milliseconds, so we have to convert minutes to milliseconds
// Log when an IP exceeds the rate limit
fastify.addHook('onSend', async (request, reply, payload) => {
  if (reply.statusCode === 429) {
    console.warn(`UUID ${validator.escape(request.body.uuid)} exceeded rate limit`);
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

  if (isDebug) {console.log(`Received heartbeat from ${request.ip} or ${request.headers['x-forwarded-for']}:`, request.body);}

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
function aggregateTotals(sourceTable, targetTable, startTime, endTime, intervalStartCol, maxRows = undefined, wipeSource = true) {
  // New signature: aggregateTotals(sourceTable, targetTable, startTime, endTime, intervalStartCol, maxRows, wipeSource)
  // maxRows: maximum number of rows to keep in targetTable (rolling window)
  // wipeSource: if true, delete source data after aggregation

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

  // Store totals in the target table
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

  // Rolling window: keep only maxRows most recent rows
  if (maxRows !== undefined && maxRows > 0) {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${targetTable}`).get().cnt;
    if (count > maxRows) {
      // Delete oldest rows
      db.prepare(`
        DELETE FROM ${targetTable}
        WHERE ${intervalStartCol} IN (
          SELECT ${intervalStartCol} FROM ${targetTable}
          ORDER BY ${intervalStartCol} ASC
          LIMIT ?
        )
      `).run(count - maxRows);
    }
  }

  // Optionally delete aggregated raw data
  if (wipeSource) {
    db.prepare(`
      DELETE FROM ${sourceTable}
      WHERE lastSeen >= ? AND lastSeen < ?
    `).run(startTime, endTime);
  }
}

// Hourly
cron.schedule('0 * * * *', () => {
  console.log(`Hourly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 60 * 60 * 1000;
  aggregateTotals('heartbeats', 'totalsHourly', startTime, endTime, 'hourStart', 24, true); // 24-hour rolling, wipe source
});

// Daily
cron.schedule('0 0 * * *', () => {
  console.log(`Daily job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 24 * 60 * 60 * 1000;
  aggregateTotals('totalsHourly', 'totalsDaily', startTime, endTime, 'dayStart', 7, false); // 7-day rolling, keep source
});

// Weekly (Sunday midnight)
cron.schedule('0 0 * * 0', () => {
  console.log(`Weekly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  aggregateTotals('totalsDaily', 'totalsWeekly', startTime, endTime, 'weekStart', 4, false); // 4-week rolling, keep source
});

// Monthly (1st of each month)
cron.schedule('0 0 1 * *', () => {
  console.log(`Monthly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const startTime = d.getTime();
  aggregateTotals('totalsWeekly', 'totalsMonthly', startTime, endTime, 'monthStart', 12, false); // 12-month rolling, keep source
});

// Yearly (Jan 1st)
cron.schedule('0 0 1 1 *', () => {
  console.log(`Yearly job at ${new Date().toUTCString()}`);
  const endTime = Date.now();
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const startTime = d.getTime();
  aggregateTotals('totalsMonthly', 'totalsYearly', startTime, endTime, 'yearStart', 25, false); // 25-year rolling, keep source
});

const width = 800; // Width of the chart
const height = 400; // Height of the chart
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

// Endpoint to get hourly totals as a chart
fastify.get('/graph/hourly', async (request, reply) => {

  try {
    // Get all hourly totals
    const rows = db.prepare('SELECT * FROM totalsHourly ORDER BY hourStart ASC LIMIT 24').all();

    // Add partial hour data from heartbeats
    const now = Date.now();
    const currentHourStart = new Date(now);
    currentHourStart.setMinutes(0, 0, 0);
    const currentHourStartMs = currentHourStart.getTime();
    const partialRows = db.prepare('SELECT version, browser, os FROM heartbeats WHERE lastSeen >= ? AND lastSeen < ?').all(currentHourStartMs, now);

    // Aggregate partial hour data
    const versionTotals = {};
    const browserTotals = {};
    const osTotals = {};
    for (const row of partialRows) {
      if (row.version) versionTotals[row.version] = (versionTotals[row.version] || 0) + 1;
      if (row.browser) browserTotals[row.browser] = (browserTotals[row.browser] || 0) + 1;
      if (row.os) osTotals[row.os] = (osTotals[row.os] || 0) + 1;
    }
    const partialHour = {
      hourStart: currentHourStartMs,
      onlineUsers: partialRows.length,
      version: JSON.stringify(versionTotals),
      browser: JSON.stringify(browserTotals),
      os: JSON.stringify(osTotals),
      lastSeen: now
    };
    rows.push(partialHour);

    const labels = rows.map(row => new Date(row.hourStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const dataOnlineUsers = rows.map(row => row.onlineUsers);
    const dataVersion = rows.map(row => JSON.parse(row.version));
    const dataBrowser = rows.map(row => JSON.parse(row.browser));
    const dataOs = rows.map(row => JSON.parse(row.os));

    // Calculate unique counts for each hour
    const uniqueVersions = dataVersion.map(obj => Object.keys(obj).length);
    const uniqueBrowsers = dataBrowser.map(obj => Object.keys(obj).length);
    const uniqueOS = dataOs.map(obj => Object.keys(obj).length);

    const chartConfig = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Users',
          data: dataOnlineUsers, // Display number of online users
          borderColor: 'rgba(75, 192, 192, 1)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: true,
        },
        {
          label: 'Versions',
          data: uniqueVersions, // Display number of unique versions
          borderColor: 'rgba(153, 102, 255, 1)',
          backgroundColor: 'rgba(153, 102, 255, 0.2)',
          fill: true,
        },
        {
          label: 'Browsers',
          data: uniqueBrowsers, // Display number of unique browsers
          borderColor: 'rgba(255, 159, 64, 1)',
          backgroundColor: 'rgba(255, 159, 64, 0.2)',
          fill: true,
        },
        {
          label: 'Operating Systems',
          data: uniqueOS, // Display number of unique OSes
          borderColor: 'rgba(255, 99, 132, 1)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: true,
        }
      ],
    },
      options: {
        responsive: false,
        scales: {
          x: {
            title: {
              display: true,
              text: 'Time',
              color: '#ffffff'
            },
            ticks: {
              maxTicksLimit: 24,
              color: '#ffffff'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Online Users',
              color: '#ffffff'
            },
            ticks: {
              color: '#ffffff',
              callback: function(value) {
                return Number.isInteger(value) ? value : '';
              }
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: '#ffffff' // legend text color
            }
          }
        }
      },
      plugins: [{
        id: 'customBackgroundColor',
        beforeDraw: (chart) => {
          const ctx = chart.ctx;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#2450A4'; // chart background color
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      }]
    };

    // Generate the chart as a buffer
    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(chartConfig);

    // Set the response type
    reply.type('image/png').send(imageBuffer);
  } catch (exception) {
    console.error('Error generating chart:', exception);
    reply.status(500).send({ error: 'Failed to generate chart' });
  }
});

// Start server
fastify.listen({ port: fastifyPort, host: '0.0.0.0' })
  .then(() => console.log(`Fastify running on port ${fastifyPort}`));