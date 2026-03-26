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
                // Handle different wrappers from Turnit API (booking, reservation, or flat)
                const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                const data = Transform.transformTurnitReservation(bookingData);

                if (!data || !data.customer || !data.customer.email) {
                    console.warn(`[Worker] Skipping booking ${bookingId}: Missing customer email or transformation failed.`);
                    continue;
                }

                console.log(`[Worker] Transformed Booking ${bookingId} - Email: ${data.customer.email}`);

                // 5. Sync to Brevo
                const contactPayload = {
                    email: data.customer.email,
                    attributes: {
                        FNAME: data.customer.firstName,
                        LNAME: data.customer.lastName,
                        ...(data.customer.phone ? { SMS: data.customer.phone } : {}),
                        BOOKING_REF: data.booking.reference,
                        DEPARTURE_DATE: data.booking.departureDate,
                        ARRIVAL_DATE: data.booking.arrivalDate,
                        PRE_TRAVEL_DATE: data.booking.preTravelDate,
                        POST_TRAVEL_DATE: data.booking.postTravelDate,
                        PAYMENT_STATUS: data.booking.status
                    },
                    updateEnabled: true
                };

                try {
                    // Try to explicitly update via PUT first, ensuring all attributes rewrite correctly
                    await Brevo.updateContactInBrevo(data.customer.email, { attributes: contactPayload.attributes });
                } catch (updateErr) {
                    // If contact doesn't exist (404), create it via POST
                    console.log(`[Worker] Contact not found for update, creating new contact...`);
                    await Brevo.syncContactToBrevo(contactPayload);
                }

                // If it's an unconfirmed/failed booking, push a cart abandonment track event
                if (['pending', 'failed'].includes(data.booking.status)) {
                    const eventPayload = {
                        event_name: 'cart_updated',
                        identifiers: {
                            email_id: data.customer.email
                        },
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
