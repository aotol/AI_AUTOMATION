const { findPreviousOutputByKey } = require('../skill-utils');

module.exports = {
  stepName: 'summarize_text',
  requiresAI: true,
  payloadDefinition: {text: 'The text to summarize.'},
  description: 'Summarize the text content clearly and concisely.',
  execute: async (context, services, stepDefinition) => {
    let sourceText;
    let sourceTextFromPayload = stepDefinition.payload && typeof stepDefinition.payload.text === 'string' && stepDefinition.payload?.text?.trim() != '' ? stepDefinition.payload.text : null;
    let sourceTextFromContext = findPreviousOutputByKey(context, "text");
    if (!sourceTextFromContext || sourceTextFromContext.trim() == '') {
      sourceTextFromContext = null;
    }
    if (stepDefinition.stepIndex === 0) {
      //Prioritize payload source text if presented
      sourceText = sourceTextFromPayload;
      if (!sourceText) {
        sourceText = sourceTextFromContext;
      }
    } else {
      //Prioritize context source text if presented
      sourceText = sourceTextFromContext;
      if (!sourceText) {
        sourceText = sourceTextFromPayload;
      }
    }
    if (!sourceText) {
      throw new Error('summarize_text step requires payload.text or previous step output.');
    }
    let sourceLanguage = findPreviousOutputByKey(context, "languageName");
    if (!sourceLanguage || sourceLanguage.trim() == '') {
      sourceLanguage = null;
    }
    const prompt = `Summarize the following ${sourceLanguage ? `${sourceLanguage} ` : ''}text clearly and concisely. Return only the summary text.\n\nText:\n${sourceText}`;
    const summaryText = await services.llmProvider.generateText(prompt);
    return {
      text: summaryText
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('summarize_text result must be an object.');
    }
    if (!result.text || typeof result.text !== 'string') {
      errors.push('summarize_text result must include text string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
