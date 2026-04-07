module.exports = {
  stepName: 'fetch_url',
  requiresAI: false,
  payloadDefinition: {url: 'The target URL to fetch.'},
  description: 'Fetch and download the page content from a given URL.',
  execute: async (context, services, stepDefinition) => {
    const url = stepDefinition.payload && stepDefinition.payload.url;
    if (!url || typeof url !== 'string') {
      throw new Error('fetch_url step requires payload.url');
    }
    const response = await fetch(url);
    const content = await response.text();
    return {
      url,
      status: response.status,
      content,
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
    if (!result.content || typeof result.content !== 'string') {
      errors.push('fetch_url result must include content string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
