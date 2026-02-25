const Turnit = require('./turnit');
const Brevo = require('./brevo');
const Transform = require('./transform');
const State = require('./state');

/**
 * Orchestrates the synchronization process.
 * 1. Read last sync time.
 * 2. Query Turnit for changes since then.
 * 3. Loop through bookings:
 *    a. Fetch full details.
 *    b. Transform data.
 *    c. Sync to Brevo.
 * 4. Update last sync time.
 */
async function runSync() {
    console.log('[Worker] Starting Sync Cycle...');

    // 1. Get State
    const lastSync = State.getLastSyncTime();
    const currentSyncStart = new Date().toISOString();
    console.log(`[Worker] Searching for bookings modified since: ${lastSync}`);

    try {
        // 2. Search Turnit
        const bookings = await Turnit.searchBookings(lastSync);
        console.log(`[Worker] Found ${bookings.length} bookings to process.`);

        for (const summary of bookings) {
            try {
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
                // Note: transform logic expects 'reservation' key if following webhook structure, 
                // but API might return it directly. Adjusting wrapper here to match transform expectation.
                // Assuming API returns { reservation: { ... } } or similar. 
                // If API returns flat booking object, wrap it:
                const bookingWrapper = fullBooking.reservation ? fullBooking : { reservation: fullBooking };

                const data = Transform.transformTurnitReservation(bookingWrapper.reservation || bookingWrapper);

                if (!data) {
                    console.warn(`[Worker] Transformation failed for booking ${summary.id}.`);
                    continue;
                }

                // 5. Sync to Brevo
                if (data.booking.status === 'confirmed') {
                    // map transform output to Brevo Contact structure
                    const contactPayload = {
                        email: data.customer.email,
                        attributes: {
                            FIRSTNAME: data.customer.firstName,
                            LASTNAME: data.customer.lastName,
                            SMS: data.customer.phone,
                            BOOKING_REF: data.booking.reference,
                            DEPARTURE_DATE: data.booking.departureDate,
                            ARRIVAL_DATE: data.booking.arrivalDate,
                            PRE_TRAVEL_DATE: data.booking.preTravelDate,
                            POST_TRAVEL_DATE: data.booking.postTravelDate,
                            PAYMENT_STATUS: data.booking.status
                        },
                        updateEnabled: true
                    };
                    await Brevo.syncContactToBrevo(contactPayload);

                } else if (['pending', 'failed'].includes(data.booking.status)) {
                    // map transform output to Brevo Event structure
                    const eventPayload = {
                        event_name: 'cart_updated',
                        identifiers: {
                            email_id: data.customer.email
                        },
                        event_properties: {
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

            } catch (err) {
                console.error(`[Worker] Error processing booking ${summary.id}:`, err.message);
                // Continue to next booking even if one fails
            }
        }

        // 6. Update State (only if we successfully searched)
        // Ensure strictly increasing time handling (maybe use max modification time from results)
        // For simplicity, using the start time of this filtered search to avoid gaps.
        State.updateLastSyncTime(currentSyncStart);
        console.log('[Worker] Sync Cycle Complete.');

    } catch (error) {
        console.error('[Worker] Fatal Error in Sync Cycle:', error.message);
    }
}

/**
 * Starts the worker on a schedule.
 * @param {number} intervalMinutes 
 */
function start(intervalMinutes = 5) {
    console.log(`[Worker] Initialized with ${intervalMinutes} minute interval.`);

    // Run immediately on start
    runSync();

    // Schedule
    setInterval(runSync, intervalMinutes * 60 * 1000);
}

module.exports = {
    start,
    runSync
};
