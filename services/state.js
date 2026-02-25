const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'sync_state.json');

/**
 * Reads the last sync timestamp from the state file.
 * Defaults to 24 hours ago if no file exists.
 * @returns {string} ISO timestamp
 */
function getLastSyncTime() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            return state.lastSyncTime;
        }
    } catch (error) {
        console.error('[State] Error reading state file:', error.message);
    }

    // Default: Return timestamp for 24 hours ago
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString();
}

/**
 * Updates the last sync timestamp in the state file.
 * @param {string} timestamp ISO timestamp
 */
function updateLastSyncTime(timestamp) {
    try {
        const state = { lastSyncTime: timestamp };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('[State] Error writing state file:', error.message);
    }
}

module.exports = {
    getLastSyncTime,
    updateLastSyncTime
};
