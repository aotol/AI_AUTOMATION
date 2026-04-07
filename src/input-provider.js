const { config } = require('./config');

function getUserInput() {
  const rawInput = process.argv.slice(2).join(' ').trim();
  if (!rawInput) {
    throw new Error('Please provide a task description as command line input. Example: node src/app.js "Summarize the latest quarterly report."');
  }
  if (typeof rawInput === 'string' && rawInput.length > config.input.maxLength) {
    throw new Error(`Input exceeds configured maximum length of ${config.input.maxLength} characters.`);
  }
  return rawInput;
}

module.exports = {
  getUserInput
};
