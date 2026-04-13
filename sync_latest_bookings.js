require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runLatestBookingSync() {
    console.log('--- STARTING LATEST BOOKING SYNC ---');
    console.log('This script finds the absolutely most recent booking (by creation date) for each user.');
    console.log('It will then sync this latest data to Brevo, including the STATUS attribute.');
    
    // Parse CLI arguments: --since YYYY-MM-DD
    const sinceIdx = process.argv.indexOf('--since');
    let searchStartTimestamp = '2025-01-01T00:00:00.000Z'; // Default

    if (sinceIdx > -1 && process.argv[sinceIdx + 1]) {
        const providedDate = process.argv[sinceIdx + 1];
        if (!isNaN(Date.parse(providedDate))) {
            searchStartTimestamp = new Date(providedDate).toISOString();
        }
    }

    // Parse CLI arguments: --status REFUNDED CANCELLED
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
    
    // Map to keep the latest booking per email
    // Key: email (string)
    // Value: { contact, data, bookingDate, bookingId }
    const latestPerEmail = new Map();

    try {
        // --- PHASE 1: Fetch and compile all historical data ---
        while (keepSearching) {
            console.log(`\n> Searching Turnit for bookings modified since: ${searchStartTimestamp}`);
            const bookings = await Turnit.searchBookings(searchStartTimestamp);

            if (bookings.length === 0) {
                console.log('\n✅ No more bookings found. Search phase complete.');
                break;
            }

            console.log(`Found ${bookings.length} bookings in this batch.`);

            for (const summary of bookings) {
                try {
                    const bookingId = summary.id || summary.bookingId;
                    if (!bookingId) continue;

                    // Depending on how many bookings you have, printing every single fetch might be noisy,
                    // but it's good for seeing progress.
                    process.stdout.write('.'); 
                    const fullBooking = await Turnit.getBookingDetails(bookingId);

                    if (!fullBooking) continue;

                    // Support for corrected object traversal
                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.contacts || data.contacts.length === 0) {
                        continue;
                    }

                    // Use createdOn to determine absolute purchase order
                    const bookingDateStr = bookingData.createdOn || summary.createdOn || searchStartTimestamp;
                    const bookingDate = new Date(bookingDateStr).getTime();

                    // Track the latest booking per contact email
                    for (const contact of data.contacts) {
                        const email = contact.email.toLowerCase();
                        
                        if (!latestPerEmail.has(email)) {
                            latestPerEmail.set(email, { contact, data, bookingDate, bookingId });
                        } else {
                            const existing = latestPerEmail.get(email);
                            // If this booking was explicitly created LATER than the previously stored one, overwrite it.
                            if (bookingDate > existing.bookingDate) {
                                latestPerEmail.set(email, { contact, data, bookingDate, bookingId });
                            }
                        }
                    }

                    totalProcessed++;
                    await sleep(50); // slight delay to prevent API overloading Turnit

                } catch (err) {
                    console.error(`\n[Sync] Error processing booking ${summary.id}:`, err.message);
                }
            }

            console.log(`\nFinished parsing batch.`);

            if (bookings.length === 100) {
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                await sleep(500);
            } else {
                keepSearching = false;
            }
        }

        console.log(`\n======================================================`);
        console.log(`✅ SEARCH PHASE COMPLETE. Parsed ${totalProcessed} total Turnit bookings.`);
        console.log(`📊 Unique Contacts compiled: ${latestPerEmail.size}`);
        console.log(`======================================================\n`);


        // --- PHASE 2: Push the aggregated "Latest Booking" to Brevo ---
        let totalSynced = 0;
        console.log(`> Starting Brevo Update for ${latestPerEmail.size} contacts...`);

        for (const [email, record] of latestPerEmail.entries()) {
            try {
                const { contact, data, bookingId } = record;
                
                // Construct Brevo payload including user STATUS
                const pushStatus = (data.booking.status || 'unknown').toUpperCase();
                
                // If the user provided --status filters, ONLY push if the latest status matches!
                if (statusFilters.length > 0 && !statusFilters.includes(pushStatus)) {
                    continue; // Skip this user because their LATEST booking is not one of the filtered statuses
                }
                
                const contactPayload = {
                    email: contact.email,
                    attributes: {
                        VORNAME: contact.firstName,
                        NACHNAME: contact.lastName,
                        BOOKING_STATUS: pushStatus, // explicitly adding status param!
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

                console.log(`[Brevo] Updating ${email} ... Latest Status: ${pushStatus} (Booking: ${data.booking.bookingCode || bookingId})`);
                await Brevo.syncContactToBrevo(contactPayload);

                // Optional: also push event if it's pending/failed (kept exactly like historical)
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

                totalSynced++;
                await sleep(200); // Wait 200ms between Brevo calls to avoid rate limits

            } catch (err) {
                console.error(`[Brevo Error] Failed to update ${email}:`, err.message);
            }
        }

        console.log(`\n✅ LATEST BOOKING SYNC COMPLETE. Successfully pushed ${totalSynced} out of ${latestPerEmail.size} contacts to Brevo.`);

    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
    }
}

runLatestBookingSync();
