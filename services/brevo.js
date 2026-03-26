const axios = require('axios');

// Brevo API Configuration
const BREVO_API_URL = 'https://api.brevo.com/v3';

function getHeaders() {
    return {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
    };
}

/**
 * Syncs a contact to Brevo.
 * @param {Object} payload - The contact payload (email, attributes, updateEnabled).
 */
async function syncContactToBrevo(payload) {
    try {
        const response = await axios.post(`${BREVO_API_URL}/contacts`, payload, { headers: getHeaders() });
        console.log(`[Brevo] Contact synced successfully. ID: ${response.data.id || 'Updated'}`);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`[Brevo Error] Sync Contact Failed. Status: ${error.response.status}`, error.response.data);
            throw new Error(`Brevo Sync Failed: ${error.response.status}`);
        } else {
            console.error(`[Brevo Error] ${error.message}`);
            throw error;
        }
    }
}

/**
 * Updates an explicit existing contact in Brevo using PUT /contacts/{identifier}
 * @param {string} email - The contact email
 * @param {Object} payload - The update payload (e.g. attributes)
 */
async function updateContactInBrevo(email, payload) {
    try {
        const response = await axios.put(`${BREVO_API_URL}/contacts/${encodeURIComponent(email)}?identifierType=email_id`, payload, { headers: getHeaders() });
        console.log(`[Brevo] Contact updated successfully. Email: ${email}`);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`[Brevo Error] Update Contact Failed. Status: ${error.response.status}`, error.response.data);
            throw new Error(`Brevo Update Failed: ${error.response.status}`);
        } else {
            console.error(`[Brevo Error] ${error.message}`);
            throw error;
        }
    }
}

/**
 * Tracks an event in Brevo.
 * @param {Object} payload - The event payload (event_name, identifiers, event_properties).
 */
async function trackEventInBrevo(payload) {
    try {
        await axios.post(`${BREVO_API_URL}/events`, payload, { headers: getHeaders() });
        console.log(`[Brevo] Event tracked successfully.`);
        return true;
    } catch (error) {
        if (error.response) {
            console.error(`[Brevo Error] Track Event Failed. Status: ${error.response.status}`);
            console.error(JSON.stringify(error.response.data, null, 2));
            throw new Error(`Brevo Event Failed: ${error.response.status}`);
        } else {
            console.error(`[Brevo Error] ${error.message}`);
            throw error;
        }
    }
}

module.exports = {
    syncContactToBrevo,
    updateContactInBrevo,
    trackEventInBrevo
};
