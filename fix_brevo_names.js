require('dotenv').config();
const Turnit = require('./services/turnit');
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runNameFix() {
    console.log('--- STARTING BREVO NAME CLEANUP MIGRATION ---');
    console.log('This script will pull all historical bookings and WIPE the old name fields (FIRSTNAME, VORNAME, etc.)');
    console.log('and correctly populate FIRST_NAME and LAST_NAME.\n');

    // Parse CLI arguments: --since YYYY-MM-DD
    const sinceIdx = process.argv.indexOf('--since');
    let searchStartTimestamp = '2025-01-01T00:00:00.000Z'; // Default

    if (sinceIdx > -1 && process.argv[sinceIdx + 1]) {
        const providedDate = process.argv[sinceIdx + 1];
        if (!isNaN(Date.parse(providedDate))) {
            searchStartTimestamp = new Date(providedDate).toISOString();
        } else {
            console.error(`ERROR: Invalid date format provided: ${providedDate}. Using default.`);
        }
    }

    console.log(`Syncing bookings modified since: ${searchStartTimestamp}\n`);

    let totalProcessed = 0;
    let keepSearching = true;

    try {
        while (keepSearching) {
            console.log(`> Searching Turnit batch...`);
            const bookings = await Turnit.searchBookings(searchStartTimestamp);

            if (bookings.length === 0) {
                console.log('\n✅ No more bookings found.');
                break;
            }

            for (const summary of bookings) {
                try {
                    const bookingId = summary.id || summary.bookingId;
                    if (!bookingId) continue;

                    const fullBooking = await Turnit.getBookingDetails(bookingId);
                    if (!fullBooking) continue;

                    const bookingData = fullBooking.booking || fullBooking.reservation || fullBooking;
                    const data = Transform.transformTurnitReservation(bookingData);

                    if (!data || !data.customer || !data.customer.email) {
                        continue;
                    }

                    console.log(`[Fixing] ${data.customer.email}...`);

                    // 🚨 THE FIX PAYLOAD 🚨
                    // Using PUT /contacts endpoint to explicitly update
                    const updatePayload = {
                        attributes: {
                            VORNAME: data.customer.firstName,
                            NACHNAME: data.customer.lastName,
                            ...(data.customer.phone ? { SMS: data.customer.phone } : {})
                        },
                        ...(process.env.BREVO_LIST_ID ? { listIds: [parseInt(process.env.BREVO_LIST_ID)] } : {})
                    };

                    await Brevo.updateContactInBrevo(data.customer.email, updatePayload);
                    totalProcessed++;
                    await sleep(300); // Respect rate limits

                } catch (err) {
                    console.error(`[Error] Failed to fix booking ${summary.id}:`, err.message);
                }
            }

            // Pagination
            if (bookings.length === 100) {
                const last = bookings[bookings.length - 1];
                searchStartTimestamp = last.createdOn || last.modifiedOn;
                await sleep(1000);
            } else {
                keepSearching = false;
            }
        }

        console.log(`\n✅ MIGRATION COMPLETE. Successfully fixed ${totalProcessed} contacts in Brevo.`);

    } catch (error) {
        console.error('\n❌ Fatal Error during migration:', error.message);
    }
}

runNameFix();
