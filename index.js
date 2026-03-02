require('dotenv').config();

// Services
const Poller = require('./services/poller');

// Start the Polling Worker
const pollingInterval = parseInt(process.env.POLLING_INTERVAL_MINUTES) || 5;

console.log('--- TWILINER & BREVO MIDDLEWARE ---');
console.log(`Initializing Turnit polling worker with ${pollingInterval} minute interval...`);

Poller.start(pollingInterval);
