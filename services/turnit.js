const axios = require('axios');

// Turnit API Configuration
const TURNIT_API_URL = process.env.TURNIT_API_URL;
const TURNIT_AUTH_ID = process.env.TURNIT_AUTH_ID; // Client ID
const TURNIT_AUTH_SECRET = process.env.TURNIT_AUTH_SECRET; // Client Secret
const TURNIT_POS_ID = process.env.TURNIT_POS_ID || 1;

// Cache for Auth Token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Authenticates with Turnit API.
 * Uses Client Credentials flow (Implementation depends on specific auth server).
 * Assuming standard OAuth2 or similar.
 */
async function getAuthToken() {
    if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
        return cachedToken;
    }

    try {
        // Construct Auth URL based on user guidance: https://identity.{{environment}}.{{IMS-system}}.turnit.tech/connect/token
        // Inferring from API URL: https://api.prelive.twiliner.turnit.tech -> environment=prelive, IMS-system=twiliner
        const defaultAuthUrl = 'https://identity.prelive.twiliner.turnit.tech/connect/token';
        const authUrl = process.env.TURNIT_AUTH_URL || defaultAuthUrl;

        console.log(`[Turnit] Requesting Auth Token from: ${authUrl}`);

        const response = await axios.post(authUrl, {
            grant_type: 'client_credentials',
            client_id: TURNIT_AUTH_ID,
            client_secret: TURNIT_AUTH_SECRET
        }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        cachedToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600;
        tokenExpiry = new Date(new Date().getTime() + (expiresIn - 60) * 1000);

        return cachedToken;
    } catch (error) {
        // Fallback for mocked/test environment or if credentials are misconfigured
        if (process.env.NODE_ENV === 'test' || !TURNIT_AUTH_ID) {
            console.warn('[Turnit] Auth failed or missing credentials. Returning mock token.');
            return 'mock-token';
        }
        console.error('[Turnit Error] Failed to get auth token:', error.message);
        throw error;
    }
}

function getHeaders(token) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    if (TURNIT_POS_ID) {
        const reqJson = JSON.stringify({ pointOfSaleId: parseInt(TURNIT_POS_ID, 10) });
        headers['Requestor'] = Buffer.from(reqJson).toString('base64');
    }

    return headers;
}

/**
 * Searches for bookings created since a given timestamp.
 * Uses POST /bookings-search with purchaseDateRange.
 * 
 * @param {string} modifiedSince - ISO timestamp string.
 * @returns {Array} - List of booking objects (summary).
 */
async function searchBookings(modifiedSince) {
    if (!TURNIT_API_URL) {
        console.warn('[Turnit] API URL not configured.');
        return [];
    }

    try {
        const token = await getAuthToken();
        const now = new Date().toISOString();

        // API requires POST /bookings-search
        // Filter by purchaseDateRange (Created Date)
        const payload = {
            purchaseDateRange: {
                startTime: modifiedSince,
                endDate: now
            },
            parameters: {
                numberOfResults: 100 // Limit batch size
            }
        };

        const response = await axios.post(`${TURNIT_API_URL}/bookings-search`, payload, {
            headers: getHeaders(token)
        });

        // Response schema: { bookingSearchResults: [ ... ] }
        return response.data.bookingSearchResults || [];

    } catch (error) {
        console.error('[Turnit Error] Search failed:', error.message);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        return [];
    }
}

/**
 * Retrieves full details for a specific booking.
 * Uses GET /bookings/{bookingId} (Assuming standard endpoint)
 * 
 * @param {string} bookingId 
 * @returns {Object} - Complete booking object.
 */
async function getBookingDetails(bookingId) {
    if (!TURNIT_API_URL) return null;

    try {
        const token = await getAuthToken();
        console.log(`Fetching details for booking ID: ${bookingId}...`);

        const response = await axios.get(`${TURNIT_API_URL}/bookings/${bookingId}`, {
            headers: getHeaders(token)
        });

        return response.data;
    } catch (error) {
        console.error(`[Turnit Error] Get Details failed for ${bookingId}:`, error.message);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        return null;
    }
}

module.exports = {
    searchBookings,
    getBookingDetails
};
