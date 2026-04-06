require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runSafetySync() {
    console.log('--- STARTING DAILY SAFETY SYNC (LAST 48 HOURS) ---');
    
    // Calculate timestamp for 48 hours ago to catch anything missed
    const date = new Date();
    date.setHours(date.getHours() - 48);
    let searchStartTimestamp = date.toISOString();

    let totalProcessed = 0;
    let keepSearching = true;

    try {
        while (keepSearching) {
            console.log(`\n> Searching Turnit for bookings modified since: ${searchStartTimestamp}`);
            const bookings = await Turnit.searchBookings(searchStartTimestamp);

            if (bookings.length === 0) {
                console.log('\n✅ No more bookings found. Daily safety sync complete.');
                break;
            }

            console.log(`Found ${bookings.length} bookings in this batch.`);

            for (const summary of bookings) {
                try {
                    const bookingId = summary.id || summary.bookingId;
                    if (!bookingId) continue;

                    console.log(`[Safety Sync] Processing Booking ID: ${bookingId}...`);
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) continue;

                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.contacts || data.contacts.length === 0) {
                        continue; // Skip silently to reduce log noise
                    }

                    // Push each contact to Brevo
                    for (const contact of data.contacts) {
                        const contactPayload = {
                            email: contact.email,
                            attributes: {
                                VORNAME: contact.firstName,
                                NACHNAME: contact.lastName,
                                ...(data.booking.bookingCode ? { BOOKING_CODE: data.booking.bookingCode } : {}),
                                ...(data.booking.departureDate ? { DEPARTURE_DATE: data.booking.departureDate } : {}),
                                ...(data.booking.arrivalDate ? { ARRIVAL_DATE: data.booking.arrivalDate } : {}),
                                ...((data.booking.origin && data.booking.origin !== 'Unknown') ? { ORIGIN: data.booking.origin } : {}),
                                ...((data.booking.destination && data.booking.destination !== 'Unknown') ? { DESTINATION: data.booking.destination } : {}),
                                ...(contact.phone ? { SMS: contact.phone } : {})
                            },
                            ...(process.env.BREVO_LIST_ID ? { listIds: [parseInt(process.env.BREVO_LIST_ID)] } : {}),
                            updateEnabled: true
                        };
                        await Brevo.syncContactToBrevo(contactPayload);

                        if (['pending', 'failed'].includes(data.booking.status)) {
                            const eventPayload = {
                                event_name: 'cart_updated',
                                identifiers: { email_id: contact.email },
                                event_properties: {
                                    firstname: contact.firstName,
                                    lastname: contact.lastName,
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
                    }

                    totalProcessed++;
                    await sleep(300); // 300ms delay to respect API rate limits

                } catch (err) {
                    console.error(`[Safety Sync] Error processing booking ${summary.id}:`, err.message);
                }
            }

            // Pagination mechanism: if we hit the limit, set the next search timestamp to the last booking's time
            if (bookings.length === 100) {
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                await sleep(1000);
            } else {
                keepSearching = false;
            }
        }

        console.log(`\n✅ DAILY SAFETY SYNC COMPLETE. Total processed/checked: ${totalProcessed}`);

    } catch (error) {
        console.error('\n❌ Fatal Error during daily safety sync:', error.message);
    }
}

// -------------------------------------------------------------
// TIMER: Run immediately on startup, then every 24 hours
// -------------------------------------------------------------
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

console.log('Starting Daily Safety Sync process...');

// Run it immediately
runSafetySync();

// And again every 24 hours
setInterval(() => {
    console.log(`\n[${new Date().toISOString()}] Initiating scheduled 24-hour safety sync...`);
    runSafetySync();
}, TWENTY_FOUR_HOURS_IN_MS);
