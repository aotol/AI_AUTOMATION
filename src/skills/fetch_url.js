module.exports = {
  stepName: 'fetch_url',
  requiresAI: false,
  payloadDefinition: {url: 'The target URL to fetch.'},
  description: 'Fetch and download the page content from a given URL.',
  execute: async (context, services, stepDefinition) => {
    const { findPreviousOutputByKey } = require('../skill-utils');
    const url = stepDefinition.payload && typeof stepDefinition.payload.url === 'string'
        ? stepDefinition.payload.url : findPreviousOutputByKey(context, "url");
    if (!url || typeof url !== 'string' || url.trim() == '') {
      throw new Error('fetch_url step requires payload.url');
    }
    const response = await fetch(url);
    const html = await response.text();
    return {
      url,
      status: response.status,
      html,
      contentType: response.headers.get('content-type') || null
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('fetch_url result must be an object.');
    }
    if (!result.url || typeof result.url !== 'string') {
      errors.push('fetch_url result must include url string.');
    }
    if (!result.html || typeof result.html !== 'string') {
      errors.push('fetch_url result must include html string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
