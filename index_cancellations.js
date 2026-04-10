require('dotenv').config();

// Services
const Poller = require('./services/poller');

// Start the CANCELLATIONS Polling Worker
const pollingInterval = parseInt(process.env.POLLING_INTERVAL_MINUTES) || 5;

console.log('--- TWILINER & BREVO MIDDLEWARE: CANCELLATIONS ONLY ---');
console.log(`Initializing dedicated Turnit polling worker for REFUNDED/CANCELLED bookings with ${pollingInterval} minute interval...`);

Poller.start({
    intervalMinutes: pollingInterval,
    statusFilters: ['REFUNDED', 'CANCELLED'],
    stateFilename: 'sync_state_cancellations.json'
});
