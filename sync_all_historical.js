require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runHistoricalSync() {
    console.log('--- STARTING HISTORICAL BREVO SYNC ---');
    console.log('Ensure you are running against the intended environment based on your .env file.');

    // Set a start date far in the past
    let searchStartTimestamp = '2020-01-01T00:00:00.000Z';
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

                    if (!bookingId) {
                        console.warn('[Sync] Booking ID not found in search result. Skipping.', summary);
                        continue;
                    }

                    console.log(`[Sync] Processing Booking ID: ${bookingId}...`);
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) {
                        console.warn(`[Sync] Failed to get details for booking ${summary.id}. Skipping.`);
                        continue;
                    }

                    const bookingWrapper = fullBooking.reservation ? fullBooking : { reservation: fullBooking };
                    const data = Transform.transformTurnitReservation(bookingWrapper.reservation || bookingWrapper);

                    if (!data) {
                        console.warn(`[Sync] Transformation failed for booking ${summary.id}.`);
                        continue;
                    }

                    console.log(`[Sync] Transformed Booking ${bookingId} - Email: ${data.customer.email}`);

                    // Push to Brevo
                    if (data.booking.status === 'confirmed') {
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
                        console.log(`  -> Synced Contact to Brevo.`);

                    } else if (['pending', 'failed'].includes(data.booking.status)) {
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
                        console.log(`  -> Tracked Abandoned Cart in Brevo.`);
                    }

                    totalProcessed++;

                    // Add a small delay between processing each booking to prevent Brevo/Turnit rate limits
                    await sleep(300);

                } catch (err) {
                    // Log the error but continue loop
                    console.error(`[Sync] Error processing booking ${summary.id}:`, err.message);
                }
            }

            // Pagination Logic
            // If the Turnit API returned exactly 100, there could be more bookings to grab.
            // Move the search cursor up to the createdOn/modifiedOn date of the *last* booking in the batch.
            if (bookings.length === 100) {
                const veryLastBooking = bookings[bookings.length - 1];
                searchStartTimestamp = veryLastBooking.createdOn || veryLastBooking.modifiedOn;

                if (!searchStartTimestamp) {
                    console.warn('Cannot find pagination timestamp on the last booking to continue search. Stopping loop to prevent infinity.');
                    keepSearching = false;
                } else {
                    console.log(`\nReaching batch limit (100). Advancing search cursor to: ${searchStartTimestamp}`);
                    // Extra safety delay before next batch pull
                    await sleep(2000);
                }
            } else {
                // If we got less than 100, it means we've hit the end of the historical backlog.
                keepSearching = false;
            }
        }

        console.log(`\n===========================================`);
        console.log(`✅ HISTORICAL SYNC COMPLETE`);
        console.log(`Total Bookings Processed: ${totalProcessed}`);
        console.log(`===========================================`);

    } catch (error) {
        console.error('\n❌ Fatal Error in Historical Sync:', error.message);
    }
}

// Start the Historical Sync
runHistoricalSync();
