const { config } = require('./config');

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logDebug(message) {
  if (config.app.debug) {
    console.debug(`[DEBUG] ${message}`);
  }
}

function logError(message) {
  console.error(`[ERROR] ${message}`);
}

module.exports = {
  logInfo,
  logDebug,
  logError
};
