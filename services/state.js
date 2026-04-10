const fs = require('fs');
const path = require('path');

function getStateFilePath(filename = 'sync_state.json') {
    return path.join(__dirname, '..', filename);
}

/**
 * Reads the last sync timestamp from the state file.
 * Defaults to 24 hours ago if no file exists.
 * @param {string} [filename] Optional custom state filename
 * @returns {string} ISO timestamp
 */
function getLastSyncTime(filename = 'sync_state.json') {
    try {
        const filePath = getStateFilePath(filename);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
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
function updateLastSyncTime(timestamp, filename = 'sync_state.json') {
    try {
        const state = { lastSyncTime: timestamp };
        fs.writeFileSync(getStateFilePath(filename), JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('[State] Error writing state file:', error.message);
    }
}

module.exports = {
    getLastSyncTime,
    updateLastSyncTime
};
