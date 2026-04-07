const { findPreviousOutputText } = require('../skill-utils');

module.exports = {
  stepName: 'summarize_text',
  requiresAI: true,
  payloadDefinition: {text: 'The text to summarize.', targetLanguage: 'The language to summarize into.'},
  description: 'Summarize the text content clearly and concisely.',
  execute: async (context, services, stepDefinition) => {
    const sourceText = stepDefinition.payload && typeof stepDefinition.payload.text === 'string'
      ? stepDefinition.payload.text
      : findPreviousOutputText(context);
    if (!sourceText) {
      throw new Error('summarize_text step requires payload.text or previous step output.');
    }
    let targetLanguage = stepDefinition.payload && typeof stepDefinition.payload.targetLanguage === 'string'
      ? stepDefinition.payload.targetLanguage
      : null;
    const prompt = `Summarize the following text clearly and concisely${targetLanguage ? ` in ${targetLanguage}` : ''}. Return only the summary text.\n\nText:\n${sourceText}`;
    const summaryText = await services.llmProvider.generateText(prompt);
    return {
      summaryText
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('summarize_text result must be an object.');
    }
    if (!result.summaryText || typeof result.summaryText !== 'string') {
      errors.push('summarize_text result must include summaryText string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
