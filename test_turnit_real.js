require('dotenv').config();
const Turnit = require('./services/turnit');

(async () => {
    console.log('--- TESTING REAL TURNIT API ---');

    // Check Config
    if (!process.env.TURNIT_API_URL || !process.env.TURNIT_AUTH_ID) {
        console.error('ERROR: Missing Turnit credentials in .env file.');
        console.error('Please set TURNIT_API_URL, TURNIT_AUTH_ID, and TURNIT_AUTH_SECRET.');
        process.exit(1);
    }

    try {
        // 1. Search for bookings created in the last 30 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const since = startDate.toISOString();

        console.log(`Searching for bookings created since: ${since}...`);
        const bookings = await Turnit.searchBookings(since);

        console.log(`Found ${bookings.length} bookings.`);

        if (bookings.length > 0) {
            console.log(`\nProcessing ${bookings.length} bookings...`);

            for (const summary of bookings) {
                const bookingId = summary.id || summary.bookingId;
                // console.log(`Fetching details for booking ID: ${bookingId}...`); // Optional: reduce noise

                try {
                    const details = await Turnit.getBookingDetails(bookingId);

                    if (details && details.booking && details.booking.purchaser && details.booking.purchaser.detail) {
                        const p = details.booking.purchaser.detail;
                        console.log(`Totally customer data found: ${p.firstName} ${p.lastName} (ID: ${bookingId})`);
                    } else {
                        console.log(`Totally customer data found (ID: ${bookingId}) - Name missing`);
                    }

                    // Add a small delay to avoid hitting rate limits if many bookings
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (err) {
                    console.error(`Failed to fetch ${bookingId}: ${err.message}`);
                }
            }
        } else {
            console.log('No recent bookings found to inspect.');
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
        if (error.response) {
            console.error('API Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
})();
