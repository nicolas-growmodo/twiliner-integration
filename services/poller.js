const Turnit = require('./turnit');
const Brevo = require('./brevo');
const Transform = require('./transform');
const State = require('./state');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Orchestrates the synchronization process.
 * 1. Read last sync time.
 * 2. Query Turnit for changes since then with pagination.
 * 3. Loop through bookings:
 *    a. Fetch full details.
 *    b. Transform data.
 *    c. Sync to Brevo.
 * 4. Update last sync time incrementally.
 */
async function runSync(options = {}) {
    const { statusFilters = [], stateFilename = 'sync_state.json' } = options;
    console.log('[Worker] Starting Sync Cycle...');

    // 1. Get State
    let searchStartTimestamp = State.getLastSyncTime(stateFilename);
    const initialSyncStart = new Date().toISOString(); // Fallback timestamp if no bookings found
    console.log(`[Worker] Searching for bookings modified since: ${searchStartTimestamp}`);

    try {
        let keepSearching = true;
        let highestProcessedTimestamp = searchStartTimestamp;
        let totalProcessed = 0;

        while (keepSearching) {
            // 2. Search Turnit
            const bookings = await Turnit.searchBookings(searchStartTimestamp);
            
            if (bookings.length === 0) {
                console.log(`[Worker] No more bookings found in this cycle. Batch complete.`);
                break;
            }

            console.log(`[Worker] Found ${bookings.length} bookings to process in this batch...`);

            for (const summary of bookings) {
                try {
                    // Update highest timestamp seen
                    const bTime = summary.modifiedOn || summary.createdOn;
                    if (bTime && new Date(bTime) > new Date(highestProcessedTimestamp)) {
                        highestProcessedTimestamp = bTime;
                    }

                    // 3. Process Each Booking
                    const bookingId = summary.id || summary.bookingId;

                    if (!bookingId) {
                        console.warn('[Worker] Booking ID not found in search result. Skipping.', summary);
                        continue;
                    }

                    console.log(`[Worker] Processing Booking ID: ${bookingId}`);
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) {
                        console.warn(`[Worker] Failed to get details for booking ${summary.id}. Skipping.`);
                        continue;
                    }

                    // 4. Transform
                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.contacts || data.contacts.length === 0) {
                        console.warn(`[Worker] Skipping booking ${bookingId}: No valid emails found or transformation failed.`);
                        continue;
                    }

                    const currentStatus = (data.booking.status || 'unknown').toUpperCase();
                    if (statusFilters.length > 0 && !statusFilters.includes(currentStatus)) {
                        console.log(`[Worker] Skipping booking ${bookingId} because status '${currentStatus}' is not in filter.`);
                        continue;
                    }

                    // 5. Sync each contact to Brevo
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

                        try {
                            const updatePayload = {
                                attributes: contactPayload.attributes,
                                ...(contactPayload.listIds ? { listIds: contactPayload.listIds } : {})
                            };
                            await Brevo.updateContactInBrevo(contact.email, updatePayload);
                        } catch (updateErr) {
                            console.log(`[Worker] Contact not found for update, creating new contact...`);
                            await Brevo.syncContactToBrevo(contactPayload);
                        }

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
                    await sleep(300); // Throttling to prevent API overloads/crashes

                } catch (err) {
                    console.error(`[Worker] Error processing booking ${summary.id}:`, err.message);
                }
            } // end loop over bookings

            // Pagination hook
            if (bookings.length >= 100) { // Turnit returns 100 per page max
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                await sleep(1000);
            } else {
                keepSearching = false;
            }
        } // end while keepSearching

        // 6. Update State
        // If we processed items, use the highest timestamp we saw. If not, advance to the time we started checking.
        const nextSyncTime = totalProcessed > 0 ? highestProcessedTimestamp : initialSyncStart;
        State.updateLastSyncTime(nextSyncTime, stateFilename);
        console.log(`[Worker] Sync Cycle Complete. Processed ${totalProcessed} bookings.`);

    } catch (error) {
        console.error('[Worker] Fatal Error in Sync Cycle:', error.message);
    }
}

/**
 * Starts the worker continuously rather than using overlapping intervals.
 * @param {Object|number} options Configuration options or legacy interval minutes
 */
async function start(options = {}) {
    let config = {};
    if (typeof options === 'number') {
        config.intervalMinutes = options;
    } else {
        config = options;
    }

    const { intervalMinutes = 5, statusFilters = [], stateFilename = 'sync_state.json' } = config;

    console.log(`[Worker] Initialized continuous polling every ${intervalMinutes} minutes. (Filters: ${statusFilters.length > 0 ? statusFilters.join(', ') : 'None'}, State: ${stateFilename})`);

    const intervalMs = intervalMinutes * 60 * 1000;

    // Async loop to guarantee no overlap or memory leaks
    while (true) {
        try {
            await runSync(config);
        } catch (err) {
            console.error('[Worker] Error in polling wrapper:', err);
        }
        
        console.log(`[Worker] Sleeping for ${intervalMinutes} minutes until next cycle...`);
        await sleep(intervalMs);
    }
}

module.exports = {
    start,
    runSync
};
