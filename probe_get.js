require('dotenv').config();
const Turnit = require('./services/turnit');
const Transform = require('./services/transform');
const fs = require('fs');

const BOOKING_ID = 'ecf54c2d-db04-40da-8038-3bf168071abd';

(async () => {
    console.log(`--- PROBING BOOKING: ${BOOKING_ID} ---`);
    console.log(`Using API: ${process.env.TURNIT_API_URL}`);

    try {
        // 1. Fetch using standard service logic
        console.log('\n[Step 1] Fetching raw details from Turnit...');
        const rawResponse = await Turnit.getBookingDetails(BOOKING_ID);

        if (!rawResponse) {
            console.error('FAILED: No response from API.');
            return;
        }

        // Save raw response for inspection
        fs.writeFileSync('probe_raw_response.json', JSON.stringify(rawResponse, null, 2));
        console.log('✅ RAW response saved to probe_raw_response.json');

        // 2. Pass through Actual Transformation Logic
        console.log('\n[Step 2] Passing through transformation logic...');

        // Handle the wrapper if present
        const bookingData = rawResponse.booking || rawResponse.reservation || rawResponse;
        const data = Transform.transformTurnitReservation(bookingData);
        console.log(data);

        if (!data) {
            console.error('❌ FAILED: Transformation returned null.');
            return;
        }

        console.log('✅ TRANSFORMATION SUCCESSFUL');
        console.log('\n--- Transformed Data ---');
        console.log(JSON.stringify(data, null, 2));

        // Final check on email (the critical field)
        if (data.customer && data.customer.email) {
            console.log('\nSUCCESS: Email found and correctly parsed:', data.customer.email);
        } else {
            console.warn('\nWARNING: Transformation succeeded but EMAIL is missing/undefined.');
        }

    } catch (error) {
        console.error('\nPROBE ERROR:', error.message);
        if (error.response) {
            console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
})();
