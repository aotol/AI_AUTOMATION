const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = [
  'app.name',
  'app.debug',
  'input.maxLength',
  'output.maxLength',
  'llm.provider',
  'llm.baseUrl',
  'llm.model',
  'llm.timeoutMs',
  'llm.maxInputChars',
  'llm.maxOutputTokens',
  'llm.apiKey',
  'llm.isReasoningModel',
  'llm.reasoningStripMode',
  'sqlite.path'
];

function loadConfig() {
  const configPath = path.resolve(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing configuration file: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in config.json: ${error.message}`);
  }

  validateConfig(parsed);
  return parsed;
}

function validateConfig(config) {
  for (const field of REQUIRED_FIELDS) {
    const value = get(config, field);
    if (value === undefined || value === null) {
      throw new Error(`Missing required config field: ${field}`);
    }

    if (field === 'app.debug' || field === 'llm.isReasoningModel') {
      if (typeof value !== 'boolean') {
        throw new Error(`Config field ${field} must be a boolean`);
      }
    }

    if (['input.maxLength', 'output.maxLength', 'llm.timeoutMs', 'llm.maxInputChars', 'llm.maxOutputTokens'].includes(field)) {
      if (typeof value !== 'number') {
        throw new Error(`Config field ${field} must be a number`);
      }
    }

    if (field === 'llm.reasoningStripMode') {
      if (!['none', 'auto'].includes(value)) {
        throw new Error(`Config field ${field} must be one of [none, auto]`);
      }
    }
  }
}

function get(obj, path, defaultValue) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return defaultValue;
    }
    current = current[part];
  }
  return current;
}

function getRequired(obj, path) {
  const value = get(obj, path);
  if (value === undefined || value === null) {
    throw new Error(`Required config value missing: ${path}`);
  }
  return value;
}

const config = loadConfig();

module.exports = {
  config,
  get,
  getRequired
};
