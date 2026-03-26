const axios = require('axios');
const fs = require('fs');

async function testHeaders() {
    const url = 'https://api.twiliner.turnit.com/bookings-search';
    try {
        const response = await axios.post(url, {
            purchaseDateRange: {
                startTime: new Date().toISOString(),
                endDate: new Date().toISOString()
            },
            parameters: { numberOfResults: 100 }
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log("SUCCESS!", response.status);
    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.log("Still 403 Forbidden WAF Blocked");
        } else if (e.response) {
            console.log(`Failed with status: ${e.response.status}`);
            console.log(e.response.data);
        } else {
            console.log("Error:", e.message);
        }
    }
}
testHeaders();
