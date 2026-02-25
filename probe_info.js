require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

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
    fs.writeFileSync('probe_info_results.txt', '');
    const log = (msg) => {
        console.log(msg);
        fs.appendFileSync('probe_info_results.txt', msg + '\n');
    };

    log('--- PROBING INFO ---');
    const token = await getAuthToken();

    const endpoints = [
        '/retailers',
        '/organizations',
        '/point-of-sale/payment-types' // Might reveal POS ID if error context is given?
    ];

    for (const ep of endpoints) {
        log(`\nChecking: ${ep}`);
        try {
            const response = await axios.get(`${BASE_URL}${ep}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });
            log(`✅ SUCCESS!`);
            log(JSON.stringify(response.data, null, 2));
        } catch (error) {
            log(`❌ FAILED: ${error.message}`);
            if (error.response) {
                log(`Status: ${error.response.status}`);
                log(`Body: ${JSON.stringify(error.response.data)}`);
            }
        }
    }
})();
