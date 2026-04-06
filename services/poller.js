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

                if (!data || !data.contacts || data.contacts.length === 0) {
                    console.warn(`[Worker] Skipping booking ${bookingId}: No valid emails found or transformation failed.`);
                    continue;
                }

                console.log(`[Worker] Transformed Booking ${bookingId} - Found ${data.contacts.length} unique contacts to sync.`);

                // 5. Sync each contact (purchaser and passengers) to Brevo
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

                    try {
                        const updatePayload = {
                            attributes: contactPayload.attributes,
                            ...(contactPayload.listIds ? { listIds: contactPayload.listIds } : {})
                        };
                        // Try to explicitly update via PUT first, ensuring all attributes rewrite correctly
                        await Brevo.updateContactInBrevo(contact.email, updatePayload);
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
                                email_id: contact.email
                            },
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
