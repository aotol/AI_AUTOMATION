const { stripHtml } = require('../skill-utils');

module.exports = {
  stepName: 'extract_text_from_html',
  requiresAI: false,
  payloadDefinition: {html: 'The html code.'},
  description: 'Extract readable text from HTML content by stripping tags and scripts.',
  execute: async (context, services, stepDefinition) => {
    let html = null;
    if (stepDefinition.payload && typeof stepDefinition.payload.html === 'string') {
      html = stepDefinition.payload.html;
    } else {
      const previous = context.stepResults
        .slice()
        .reverse()
        .find((step) => step.output && typeof step.output.content === 'string');
      if (previous) {
        html = previous.output.content;
      }
    }
    if (!html) {
      throw new Error('extract_text_from_html step requires HTML content from payload.html or a previous fetch_url step.');
    }
    const text = stripHtml(html);
    return { text };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('extract_text_from_html result must be an object.');
    }
    if (!result.text || typeof result.text !== 'string') {
      errors.push('extract_text_from_html result must include text string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
