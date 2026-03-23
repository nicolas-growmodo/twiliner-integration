require('dotenv').config();
const Turnit = require('./services/turnit');

(async () => {
    console.log('--- TESTING TURNIT API: FETCH PURCHASER ---');

    // Check Config
    if (!process.env.TURNIT_API_URL || !process.env.TURNIT_AUTH_ID) {
        console.error('ERROR: Missing Turnit credentials in .env file.');
        console.error('Please set TURNIT_API_URL, TURNIT_AUTH_ID, and TURNIT_AUTH_SECRET.');
        process.exit(1);
    }

    try {
        // 1. Search for bookings created in the last 5 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 5);
        const since = startDate.toISOString();

        console.log(`Searching for bookings created since: ${since}...`);
        const bookings = await Turnit.searchBookings(since);

        console.log(`Found ${bookings.length} bookings.`);

        if (bookings.length > 0) {
            console.log(`\nProcessing ${bookings.length} bookings...`);

            for (const summary of bookings) {
                const bookingId = summary.id || summary.bookingId;

                try {
                    // 2. Fetch only the Purchaser Details for this booking
                    const purchaserData = await Turnit.getPurchaserDetails(bookingId);

                    if (purchaserData && purchaserData.purchaser && purchaserData.purchaser.detail) {
                        const p = purchaserData.purchaser.detail;
                        console.log(`✅ Purchaser found for ${bookingId}: ${p.firstName} ${p.lastName} (${p.email})`);
                    } else {
                        console.log(`⚠️ Purchaser abstract or missing detail for ${bookingId}`);
                        console.log(JSON.stringify(purchaserData, null, 2));
                    }

                    // Add a small delay to avoid hitting rate limits
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (err) {
                    console.error(`Failed to fetch purchaser for ${bookingId}: ${err.message}`);
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
