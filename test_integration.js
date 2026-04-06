require('dotenv').config();
const Turnit = require('./services/turnit');
const Transform = require('./services/transform');
const Brevo = require('./services/brevo');

(async () => {
    console.log('--- TESTING FULL INTEGRATION FLOW ---');

    const BOOKING_ID = '04ac6940-d720-4746-9f55-24c89da24464'; // Known valid ID

    try {
        // 1. Fetch from Turnit
        console.log(`\n1. Fetching Booking Details for ${BOOKING_ID}...`);
        const fullBooking = await Turnit.getBookingDetails(BOOKING_ID);

        if (!fullBooking) {
            console.error('FAILED: Could not fetch booking.');
            return;
        }
        console.log('✅ Fetched Booking.');

        // Log requested by user
        // Access via .booking wrapper if present
        const bookingData = fullBooking.booking || fullBooking;

        if (bookingData.purchaser && bookingData.purchaser.detail) {
            const p = bookingData.purchaser.detail;
            console.log(`\nTotally customer data found: ${p.firstName} ${p.lastName}`);
        } else {
            console.log('\nTotally customer data found, but name is missing in purchaser detail.');
        }

        // 2. Transform
        console.log('\n2. Transforming Data...');
        const transformed = Transform.transformTurnitReservation(bookingData);

        if (!transformed) {
            console.error('FAILED: Transformation returned null.');
            return;
        }
        console.log('✅ Transformation Successful.');
        // console.log(JSON.stringify(transformed, null, 2));

        // 3. Push to Brevo
        console.log('\n3. Pushing to Brevo...');

        // Use a dummy email to avoid spamming real customers if needed, 
        // or just use the real one if it's a test account.
        // For safety, let's log what we WOULD do.

        console.log(`\nFound ${transformed.contacts.length} unique contacts (passengers + purchaser).`);

        if (!process.env.BREVO_API_KEY) {
            console.warn('SKIPPING PUSH: No BREVO_API_KEY in .env');
            return;
        }

        for (const contact of transformed.contacts) {
            console.log(`\nSyncing contact: ${contact.email} (${contact.firstName} ${contact.lastName})`);

            const contactPayload = {
                email: contact.email,
                attributes: {
                    VORNAME: contact.firstName, // Changed to VORNAME based on actual attribute mappings
                    NACHNAME: contact.lastName, // Changed to NACHNAME based on actual attribute mappings
                    ...(contact.phone ? { SMS: contact.phone } : {}),
                    ...(transformed.booking.bookingCode ? { BOOKING_CODE: transformed.booking.bookingCode } : {}),
                    DEPARTURE_DATE: transformed.booking.departureDate,
                    ARRIVAL_DATE: transformed.booking.arrivalDate,
                    PRE_TRAVEL_DATE: transformed.booking.preTravelDate,
                    POST_TRAVEL_DATE: transformed.booking.postTravelDate,
                    PAYMENT_STATUS: transformed.booking.status
                },
                updateEnabled: true
            };

            const result = await Brevo.syncContactToBrevo(contactPayload);
            console.log(`✅ Brevo Sync Successful for ${contact.email}`);
        }

    } catch (error) {
        console.error('❌ Integration Test Failed:', error.message);
    }
})();
