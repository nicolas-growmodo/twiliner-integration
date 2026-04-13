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

    // Parse CLI arguments: --status REFUNDED CANCELLED RELEASED
    const statusIdx = process.argv.indexOf('--status');
    const statusFilters = [];
    if (statusIdx > -1) {
        for (let i = statusIdx + 1; i < process.argv.length; i++) {
            if (process.argv[i].startsWith('--')) break;
            statusFilters.push(process.argv[i].toUpperCase());
        }
    }
    
    if (statusFilters.length > 0) {
        console.log(`Filtering final push for statuses: ${statusFilters.join(', ')}`);
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

                    if (!data || !data.contacts || data.contacts.length === 0) {
                        console.warn(`[Sync] Skipping ${bookingId}: No valid emails found.`);
                        continue;
                    }

                    const pushStatus = (data.booking.status || 'unknown').toUpperCase();

                    // If the user provided --status filters, ONLY push if this booking's status matches!
                    if (statusFilters.length > 0 && !statusFilters.includes(pushStatus)) {
                        continue; // Skip this booking entirely because its status is not one of the filtered statuses
                    }

                    // Push each contact to Brevo
                    for (const contact of data.contacts) {
                        const contactPayload = {
                            email: contact.email,
                            attributes: {
                                VORNAME: contact.firstName,
                                NACHNAME: contact.lastName,
                                BOOKING_STATUS: (data.booking.status || 'unknown').toUpperCase(),
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
