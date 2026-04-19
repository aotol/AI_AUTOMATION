const { findPreviousOutputByKey, getLanguageFromText, getLanguageNameFromLanguageCode } = require('../skill-utils');
module.exports = {
  stepName: 'translate_text',
  requiresAI: true,
  payloadDefinition: {text: 'The text provided by the task for translation.', targetLanguage: 'The target language translate into.'},
  description: 'Translate the text into target language. e.g.: If the text is "Translate Hello how are you into Chinese", then text is "Hello how are you" and targetLanguage is "Chinese".',
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
      throw new Error('translate_text step requires payload.text or previous step output.');
    }

    let targetLanguage = stepDefinition.payload && typeof stepDefinition.payload.targetLanguage === 'string'
    ? stepDefinition.payload.targetLanguage
    : null;

    targetLanguage = getLanguageNameFromLanguageCode(targetLanguage);

    let language = await getLanguageFromText(sourceText);
    const detectedLanguageName = language.languageName;

    const prompt = `Translate the following ${detectedLanguageName ? `${detectedLanguageName} ` : ''}text into ${targetLanguage} and only return the translated text in ${targetLanguage}.\n\nText:\n${sourceText}`;
    const translatedText = await services.llmProvider.generateText(prompt);
    return {
      text: translatedText,
      targetLanguage,
      sourceLanguageCode: findPreviousOutputByKey(context, 'languageCode') || null
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('translate_text result must be an object.');
    }
    if (!result.text || typeof result.text !== 'string') {
      errors.push('translate_text result must include text string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
