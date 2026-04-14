const { stripHtml } = require('../skill-utils');

module.exports = {
  stepName: 'extract_text_from_html',
  requiresAI: false,
  payloadDefinition: {html: 'The html code.'},
  description: 'Extract readable text from HTML content by stripping tags and scripts.',
  execute: async (context, services, stepDefinition) => {
    const { findPreviousOutputByKey } = require('../skill-utils');
    let html;
    let htmlFromPayload = stepDefinition.payload && typeof stepDefinition.payload.html === 'string' && stepDefinition.payload?.html?.trim() != '' ? stepDefinition.payload.html : null;
    let htmlFromContext = findPreviousOutputByKey(context, "html");
    if (!htmlFromContext || htmlFromContext.trim() == '') {
      htmlFromContext = null;
    }
    if (stepDefinition.stepIndex === 0) {
      //Prioritize payload html if presented
      html = htmlFromPayload;
      if (!html) {
        html = htmlFromContext;
      }
    } else {
      //Prioritize context html if presented
      html = htmlFromContext;
      if (!html) {
        html = htmlFromPayload;
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
