console.log("Starting node server...");
require('dotenv').config();
const fs = require('fs');
const Fastify = require('fastify');
const validator = require('validator');
const db = require('./database'); // Import the database
const cron = require('node-cron');

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const ChartDataLabels = require('chartjs-plugin-datalabels');

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


// CHARTS


const width = 800; // Width of the chart
const height = 400; // Height of the chart
const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width,
  height,
  plugins: {
    modern: [ChartDataLabels]
  }
});

let cachedChartHourlyMain = null; // Buffer for the cached chart image main
let cachedChartHourlyVersion = null; // Buffer for the cached chart image version
let cachedChartHourlyBrowser = null; // Buffer for the cached chart image browser
let cachedChartHourlyOS = null; // Buffer for the cached chart image OS

async function generateHourlyChart() {
  try {
    // Get all hourly totals
    const rows = db.prepare('SELECT * FROM totalsHourly ORDER BY hourStart DESC LIMIT 24').all().reverse();

    // Add partial hour data from heartbeats
    const now = Date.now();
    console.log(`Generating hourly chart at ${new Date(now).toLocaleTimeString()}`);
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

    // Aggregate all version counts across all hours.
    // This will be used to display the number of each different version.
    const uniqueVersionTotals = {};
    for (const hourObj of dataVersion) {
      for (const [version, count] of Object.entries(hourObj)) {
        uniqueVersionTotals[version] = (uniqueVersionTotals[version] || 0) + count;
      }
    }
    // Aggregate all browser counts across all hours
    const uniqueBrowserTotals = {};
    for (const hourObj of dataBrowser) {
      for (const [browser, count] of Object.entries(hourObj)) {
        uniqueBrowserTotals[browser] = (uniqueBrowserTotals[browser] || 0) + count;
      }
    }
    // Aggregate all OS counts across all hours
    const uniqueOSTotals = {};
    for (const hourObj of dataOs) {
      for (const [os, count] of Object.entries(hourObj)) {
        uniqueOSTotals[os] = (uniqueOSTotals[os] || 0) + count;
      }
    }

    // Combined/Redacted Versions
    const combinedVersionTotals = combineSmallCounts(Object.keys(uniqueVersionTotals), Object.values(uniqueVersionTotals), 25*24);
    const uniqueVersionTotalsColors = generateDistinctColors(combinedVersionTotals.labels.length);
    // Combined/Redacted Browsers
    const combinedBrowserTotals = combineSmallCounts(Object.keys(uniqueBrowserTotals), Object.values(uniqueBrowserTotals), 25*24);
    const uniqueBrowserTotalsColors = generateDistinctColors(combinedBrowserTotals.labels.length);
    // Combined/Redacted OS
    const combinedOSTotals = combineSmallCounts(Object.keys(uniqueOSTotals), Object.values(uniqueOSTotals), 25*24);
    const uniqueOSTotalsColors = generateDistinctColors(combinedOSTotals.labels.length);

    const gridLineColor = '#3690EA';

    // Generate the config files for the hourly charts
    const hourlyChartConfigMain = generateHourlyChartConfigMain(labels, dataOnlineUsers, uniqueVersions, uniqueBrowsers, uniqueOS, gridLineColor);
    const hourlyChartConfigVersion = generateHourlyChartConfigPie('Version Distribution', combinedVersionTotals.labels, combinedVersionTotals.data, uniqueVersionTotalsColors);
    const hourlyChartConfigBrowser = generateHourlyChartConfigPie('Browser Distribution', combinedBrowserTotals.labels, combinedBrowserTotals.data, uniqueBrowserTotalsColors);
    const hourlyChartConfigOS = generateHourlyChartConfigPie('OS Distribution', combinedOSTotals.labels, combinedOSTotals.data, uniqueOSTotalsColors);

    // Save the new charts to cache
    cachedChartHourlyMain = await chartJSNodeCanvas.renderToBuffer(hourlyChartConfigMain);
    cachedChartHourlyVersion = await chartJSNodeCanvas.renderToBuffer(hourlyChartConfigVersion);
    cachedChartHourlyBrowser = await chartJSNodeCanvas.renderToBuffer(hourlyChartConfigBrowser);
    cachedChartHourlyOS = await chartJSNodeCanvas.renderToBuffer(hourlyChartConfigOS);
  } catch (exception) {
    console.error('Error generating chart:', exception);
    cachedChartHourlyMain = null;
  }
}
// Generate once at startup
generateHourlyChart();



// CRON




// Generate hourly chart every 5 minutes
cron.schedule('*/5 * * * *', () => {
  generateHourlyChart();
});


// Hourly
// cron.schedule('0 * * * *', () => {
//   console.log(`Hourly job at ${new Date().toUTCString()}`);
//   const endTime = Date.now();
//   const startTime = endTime - 60 * 60 * 1000;
//   aggregateTotals('heartbeats', 'totalsHourly', startTime, endTime, 'hourStart', 0, true); // no rolling, wipe source
// });

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




// ENDPOINTS





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


// Endpoint to get hourly totals as a chart
fastify.get('/chart/hourly', async (request, reply) => {

  let serveThisChart = undefined;

  switch (request.query?.type) {
    case 'version': // Handle version chart request
      serveThisChart = cachedChartHourlyVersion;
      break;
    case 'browser':
      // Handle browser chart request
      serveThisChart = cachedChartHourlyBrowser;
      break;
    case 'os':
      // Handle OS chart request
      serveThisChart = cachedChartHourlyOS;
      break;
    case undefined:
      serveThisChart = cachedChartHourlyMain; // Default to hourly line chart
      break;
  }

  if (serveThisChart) {
    reply.header('Cache-Control', 'max-age=60, must-revalidate'); // Cache for 60 seconds
    reply.type('image/png').send(serveThisChart);
  } else {
    reply.status(503).send({ error: 'Chart not available yet' });
  }
});

// Start server
fastify.listen({ port: fastifyPort, host: '0.0.0.0' })
  .then(() => console.log(`Fastify running on port ${fastifyPort}`));

console.log('Server started successfully!'); 




// HELPER FUNCTIONS





function generateDistinctColors(n) {
  const colors = [];
  for (let i = 0; i < n; i++) {
    // Evenly distribute hues, use full saturation and 40% lightness for vibrancy
    const hue = Math.round((360 * i) / n);
    colors.push(`hsl(${hue}, 80%, 40%)`);
  }
  return colors;
}

function combineSmallCounts(labels, data, threshold = 50) {
  const newLabels = [];
  const newData = [];
  let otherCount = 0;

  for (let i = 0; i < labels.length; i++) {
    if (data[i] < threshold) {
      otherCount += data[i];
    } else {
      newLabels.push(labels[i]);
      newData.push(data[i]);
    }
  }

  if (otherCount > 0) {
    newLabels.push('Other');
    newData.push(otherCount);
  }

  return { labels: newLabels, data: newData };
}

function generateHourlyChartConfigMain(labels, dataOnlineUsers, uniqueVersions, uniqueBrowsers, uniqueOS, gridLineColor = 'rgba(255, 255, 255, 0.1)') {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Users',
          data: dataOnlineUsers,
          borderColor: 'rgba(75, 192, 192, 1)',
          backgroundColor: 'rgba(75, 192, 192, 0.15)',
          fill: true,
          yAxisID: 'y',
        },
        {
          label: 'Versions',
          data: uniqueVersions,
          borderColor: '#E866C5',
          backgroundColor: 'rgba(153, 102, 255, 0.15)',
          fill: true,
          yAxisID: 'y2',
        },
        {
          label: 'Browsers',
          data: uniqueBrowsers,
          borderColor: 'rgba(255, 159, 64, 1)',
          backgroundColor: 'rgba(255, 159, 64, 0.15)',
          fill: true,
          yAxisID: 'y2',
        },
        {
          label: 'Operating Systems',
          data: uniqueOS,
          borderColor: 'rgba(255, 99, 132, 1)',
          backgroundColor: 'rgba(255, 99, 132, 0.15)',
          fill: true,
          yAxisID: 'y2',
        }
      ]
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
          },
          grid: {
            color: gridLineColor,
            lineWidth: 2
          }
        },
        y: {
          title: {
            display: true,
            text: 'Online Users',
            color: '#ffffff'
          },
          position: 'left',
          ticks: {
            color: '#ffffff',
            callback: function(value) {
              return Number.isInteger(value) ? value : '';
            }
          },
          grid: {
            color: gridLineColor
          }
        },
        y2: {
          title: {
            display: true,
            text: 'Computer Statistics',
            color: '#ffffff'
          },
          position: 'right',
          ticks: {
            color: '#ffffff',
            callback: function(value) {
              return Number.isInteger(value) ? value : '';
            }
          },
          grid: {
            drawOnChartArea: true,
            color: gridLineColor
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ffffff'
          }
        },
        datalabels: {
          display: false // Disables data labels on the points
        }
      }
    },
    plugins: [{
      id: 'customBackgroundColor',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#2450A4';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };
}

function generateHourlyChartConfigPie(title, labels, data, colors) {
  return {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        label: title,
        data: data,
        backgroundColor: colors,
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#ffffff' } },
        datalabels: {
          color: '#fff',
          font: { weight: 'bold' },
          formatter: function(value, context) {
            // Only show label if slice is at least 5% of total
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percent = value / total;
            return percent > 0.05 ? context.chart.data.labels[context.dataIndex] : '';
          }
        },
        title: {
          display: true,
          text: title,
          color: '#ffffff',
          font: { size: 22 }
        }
      }
    },
    plugins: [{
      id: 'customBackgroundColor',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#2450A4';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };
}