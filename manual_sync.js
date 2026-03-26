require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runManualSync() {
    console.log('--- STARTING MANUAL TURNIT TO BREVO SYNC ---');

    // Parse CLI arguments: --since YYYY-MM-DD
    const sinceIdx = process.argv.indexOf('--since');
    let searchStartTimestamp = '2025-01-01T00:00:00.000Z'; // Default

    if (sinceIdx > -1 && process.argv[sinceIdx + 1]) {
        const providedDate = process.argv[sinceIdx + 1];
        // Basic validation: ensure it's a date
        if (!isNaN(Date.parse(providedDate))) {
            searchStartTimestamp = new Date(providedDate).toISOString();
        } else {
            console.error(`ERROR: Invalid date format provided: ${providedDate}. Using default: ${searchStartTimestamp}`);
        }
    }

    console.log(`Syncing bookings modified since: ${searchStartTimestamp}`);

    let totalProcessed = 0;
    let keepSearching = true;

    try {
        while (keepSearching) {
            console.log(`\n> Querying Turnit batch...`);
            const bookings = await Turnit.searchBookings(searchStartTimestamp);

            if (bookings.length === 0) {
                console.log('\n✅ No more bookings found in this range.');
                break;
            }

            console.log(`Found ${bookings.length} bookings to process.`);

            for (const summary of bookings) {
                try {
                    const bookingId = summary.id || summary.bookingId;
                    if (!bookingId) continue;

                    console.log(`[Sync] Fetching ${bookingId}...`);
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) {
                        console.warn(`[Sync] Failed to get details for ${bookingId}.`);
                        continue;
                    }

                    // Handle deep structure (Fix applied to matching poller logic)
                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.customer || !data.customer.email) {
                        console.warn(`[Sync] Skipping ${bookingId}: Missing email or transform failed.`);
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
                    console.error(`[Sync] Error processing booking ${summary.id || 'N/A'}:`, err.message);
                }
            }

            // Pagination for batches of 100
            if (bookings.length === 100) {
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                console.log(`Advancing cursor to ${searchStartTimestamp}...`);
                await sleep(1000);
            } else {
                keepSearching = false;
            }
        }

        console.log(`\n✅ MANUAL SYNC COMPLETE. Total Processed: ${totalProcessed}`);

    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
    }
}

runManualSync();
