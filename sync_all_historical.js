require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runHistoricalSync() {
    console.log('--- STARTING HISTORICAL BREVO SYNC ---');
    
    // Parse CLI arguments: --since YYYY-MM-DD
    const sinceIdx = process.argv.indexOf('--since');
    let searchStartTimestamp = '2025-01-01T00:00:00.000Z'; // Default

    if (sinceIdx > -1 && process.argv[sinceIdx + 1]) {
        const providedDate = process.argv[sinceIdx + 1];
        if (!isNaN(Date.parse(providedDate))) {
            searchStartTimestamp = new Date(providedDate).toISOString();
        }
    }

    let totalProcessed = 0;
    let keepSearching = true;

    try {
        while (keepSearching) {
            console.log(`\n> Searching Turnit for bookings modified since: ${searchStartTimestamp}`);
            const bookings = await Turnit.searchBookings(searchStartTimestamp);

            if (bookings.length === 0) {
                console.log('\n✅ No more bookings found. Historical sync complete.');
                break;
            }

            console.log(`Found ${bookings.length} bookings in this batch.`);

            for (const summary of bookings) {
                try {
                    const bookingId = summary.id || summary.bookingId;
                    if (!bookingId) continue;

                    console.log(`[Sync] Processing Booking ID: ${bookingId}...`);
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) continue;

                    // Support for corrected object traversal (Fix for Brevo 400 errors)
                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.customer || !data.customer.email) {
                        console.warn(`[Sync] Skipping ${bookingId}: Missing email.`);
                        continue;
                    }

                    // Push to Brevo
                    const contactPayload = {
                        email: data.customer.email,
                        attributes: {
                            VORNAME: data.customer.firstName,
                            NACHNAME: data.customer.lastName,
                            ...(data.customer.phone ? { SMS: data.customer.phone } : {})
                        },
                        ...(process.env.BREVO_LIST_ID ? { listIds: [parseInt(process.env.BREVO_LIST_ID)] } : {}),
                        updateEnabled: true
                    };
                    await Brevo.syncContactToBrevo(contactPayload);

                    if (['pending', 'failed'].includes(data.booking.status)) {
                        const eventPayload = {
                            event_name: 'cart_updated',
                            identifiers: { email_id: data.customer.email },
                            event_properties: {
                                firstname: data.customer.firstName,
                                lastname: data.customer.lastName,
                                id: data.booking.reference,
                                price: data.booking.totalPrice,
                                currency: data.booking.currency,
                                status: data.booking.status,
                                departure_date: data.booking.departureDate,
                                origin: data.booking.origin,
                                destination: data.booking.destination
                            }
                        };
                        await Brevo.trackEventInBrevo(eventPayload);
                    }

                    totalProcessed++;
                    await sleep(300);

                } catch (err) {
                    console.error(`[Sync] Error processing booking ${summary.id}:`, err.message);
                }
            }

            if (bookings.length === 100) {
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                await sleep(1000);
            } else {
                keepSearching = false;
            }
        }

        console.log(`\n✅ HISTORICAL SYNC COMPLETE. Total: ${totalProcessed}`);

    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
    }
}

runHistoricalSync();
