require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const BOOKING_ID = '4d4d14e8-3b21-4672-9241-4207b76648cb';
const BASE_URL = 'https://api.prelive.twiliner.turnit.tech/retailer';

async function getAuthToken() {
    try {
        const response = await axios.post('https://identity.prelive.twiliner.turnit.tech/connect/token', {
            grant_type: 'client_credentials',
            client_id: process.env.TURNIT_AUTH_ID,
            client_secret: process.env.TURNIT_AUTH_SECRET
        }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (e) {
        console.error('Auth Failed:', e.message);
        process.exit(1);
    }
}

(async () => {
    fs.writeFileSync('probe_get_results.txt', '');
    const log = (msg) => {
        console.log(msg);
        fs.appendFileSync('probe_get_results.txt', msg + '\n');
    };

    log('--- PROBING DETAILED ERROR (JSON HEADER) ---');
    const token = await getAuthToken();

    // 2. Check Booking with Key Variations
    const url = `${BASE_URL}/bookings/${BOOKING_ID}`;
    log(`Checking: ${url}`);

    const variations = [
        { label: 'pointOfSaleId: 1', val: { pointOfSaleId: 1 } },
        { label: 'pointOfSaleId: "1"', val: { pointOfSaleId: "1" } },
        { label: 'salesPointId: 1', val: { salesPointId: 1 } }, // Retry
        { label: 'posId: 1', val: { posId: 1 } },
        { label: 'Combined', val: { organizationId: "1", pointOfSaleId: "1" } },
        { label: 'Combined 2', val: { organizationId: 1, salesPointId: 1 } },
        // Try to match the auth response structure if any?
        { label: 'Lower case', val: { pointofsaleid: 1 } }
    ];

    for (const v of variations) {
        log(`\nTesting: ${v.label}`);
        const b64 = Buffer.from(JSON.stringify(v.val)).toString('base64');

        try {
            await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Requestor': b64
                }
            });
            log(`✅ SUCCESS! Found with ${v.label}.`);
            fs.writeFileSync('valid_req_json.txt', JSON.stringify(v.val));
            return;
        } catch (error) {
            if (error.response) {
                log(`  [${error.response.status}] ${error.response.statusText}`);
                if (error.response.status === 400 || error.response.status === 403 || error.response.status === 404) {
                    log(`  Body: ${JSON.stringify(error.response.data)}`);
                }
            } else {
                log(`  [ERROR] ${error.message}`);
            }
        }
    }
})();
