require('dotenv').config();
const axios = require('axios');

const BREVO_API_URL = 'https://api.brevo.com/v3';
const BREVO_HEADERS = {
    'accept': 'application/json',
    'api-key': process.env.BREVO_API_KEY,
    'content-type': 'application/json'
};

async function verifyBrevoKey() {
    console.log("--- TESTING BREVO API KEY ---");
    try {
        console.log("Validating connection to Brevo...");
        const res = await axios.get(`${BREVO_API_URL}/account`, { headers: BREVO_HEADERS });
        console.log("✅ Success! Connected to Brevo.");
        console.log("Account Details:");
        console.log(`- Email: ${res.data.email}`);
        console.log(`- Company: ${res.data.companyName}`);
    } catch (error) {
        console.error("❌ Failed to connect to Brevo.");
        console.error("Message:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            const fs = require('fs');
            fs.writeFileSync('brevo_error.json', JSON.stringify(error.response.data, null, 2));
            console.error("Data written to brevo_error.json");
        }
    }
}

verifyBrevoKey();
