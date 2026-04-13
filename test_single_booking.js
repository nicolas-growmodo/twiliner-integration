require('dotenv').config();
const Turnit = require('./services/turnit');
const Transform = require('./services/transform');
const Brevo = require('./services/brevo');

async function testSingleBooking() {
    const args = process.argv.slice(2);
    const bookingId = args[0];

    if (!bookingId) {
        console.error("Usage: node test_single_booking.js <booking-id>");
        console.error("Example: node test_single_booking.js 6923d70a-c6d1-40ae-b9df-ff8d97a1632e");
        process.exit(1);
    }

    console.log(`\n--- TESTING BOOKING ID: ${bookingId} ---\n`);

    try {
        console.log(`> Fetching booking from Turnit API...`);
        const fullBooking = await Turnit.getBookingDetails(bookingId);

        if (!fullBooking) {
            console.error("❌ Booking not found or failed to fetch.");
            return;
        }

        console.log(`✅ successfully fetched. Processing data...`);

        // Save raw response to probe_raw_response.json
        const fs = require('fs');
        fs.writeFileSync('probe_raw_response.json', JSON.stringify(fullBooking, null, 2));
        console.log(`(Raw response has been saved to probe_raw_response.json for inspection)\n`);

        // Account for Turnit response structures
        const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
        const data = Transform.transformTurnitReservation(bookingData);

        if (!data) {
            console.error("❌ Transformation failed.");
            return;
        }

        console.log("\n==================================");
        console.log("       TRANSFORMED DATA");
        console.log("==================================\n");

        console.log(JSON.stringify(data, null, 2));

        console.log("\n==================================");
        console.log("       MOCK BREVO PAYLOAD");
        console.log("==================================\n");

        if (data.contacts && data.contacts.length > 0) {
            for (const contact of data.contacts) {
                const pushStatus = (data.booking.status || 'unknown').toUpperCase();
                console.log(`Contact Email: ${contact.email}`);
                console.log(`Calculated Final Status: ${pushStatus}`);
                
                const brevoAttributes = {
                    VORNAME: contact.firstName,
                    NACHNAME: contact.lastName,
                    BOOKING_STATUS: pushStatus,
                    ...(data.booking.bookingCode ? { BOOKING_CODE: data.booking.bookingCode } : {}),
                    ...(data.booking.ticketNumber ? { TICKET_NUMBER: data.booking.ticketNumber } : {}),
                    ...(data.booking.totalPrice !== undefined ? { BOOKING_PRICE: data.booking.totalPrice } : {}),
                    ...(data.booking.currency ? { CURRENCY: data.booking.currency } : {}),
                    ...(data.booking.departureDate ? { DEPARTURE_DATE: data.booking.departureDate } : {}),
                    ...(data.booking.departureTime ? { DEPARTURE_TIME: data.booking.departureTime } : {}),
                    ...(data.booking.arrivalDate ? { ARRIVAL_DATE: data.booking.arrivalDate } : {}),
                    ...(data.booking.arrivalTime ? { ARRIVAL_TIME: data.booking.arrivalTime } : {}),
                    ...((data.booking.origin && data.booking.origin !== 'Unknown') ? { ORIGIN: data.booking.origin } : {}),
                    ...((data.booking.destination && data.booking.destination !== 'Unknown') ? { DESTINATION: data.booking.destination } : {}),
                    ...(contact.phone ? { SMS: contact.phone } : {})
                };
                
                console.log("Brevo Attributes Payload:");
                console.log(JSON.stringify(brevoAttributes, null, 2));

                const contactPayload = {
                    email: contact.email,
                    attributes: brevoAttributes,
                    ...(process.env.BREVO_LIST_ID ? { listIds: [parseInt(process.env.BREVO_LIST_ID)] } : {}),
                    updateEnabled: true
                };

                try {
                    console.log(`\n> Syncing to Brevo...`);
                    await Brevo.syncContactToBrevo(contactPayload);
                    console.log(`✅ Successfully pushed ${contact.email} to Brevo with status ${pushStatus}\n`);
                } catch (brevoErr) {
                    console.error(`❌ Failed to push ${contact.email} to Brevo:`, brevoErr.message, "\n");
                }
            }
        } else {
            console.log("No valid contacts were parsed.");
        }

    } catch (error) {
        console.error("\n❌ Error:", error.message);
    }
}

testSingleBooking();
