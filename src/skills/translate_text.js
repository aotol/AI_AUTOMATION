const { findPreviousOutputByKey } = require('../skill-utils');

module.exports = {
  stepName: 'translate_text',
  requiresAI: true,
  payloadDefinition: {text: 'The text to translate.', targetLanguage: 'The language name translate into.'},
  description: 'Translate text into a target language. Can use detected language from previous detect_language step to determine source language.',
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
    const detectedLanguageCode = findPreviousOutputByKey(context, 'languageCode');
    const detectedLanguageName = findPreviousOutputByKey(context, 'languageName');
    if (!targetLanguage) {  
      if (detectedLanguageName && detectedLanguageName !== 'Unknown') {
        targetLanguage = detectedLanguageName;
      } else if (detectedLanguageCode && detectedLanguageCode !== 'unknown') {
        const languageMap = {
          en: 'English',
          zh: 'Chinese',
          fr: 'French',
          de: 'German',
          es: 'Spanish',
          ja: 'Japanese',
          ko: 'Korean',
          ru: 'Russian',
          ar: 'Arabic',
          pt: 'Portuguese',
          hi: 'Hindi',
          vi: 'Vietnamese'
        };
        targetLanguage = languageMap[detectedLanguageCode] || detectedLanguageCode;
      } else {
        targetLanguage = 'English';
      }
    }

    const prompt = `Translate the following ${detectedLanguageName ? `${detectedLanguageName} ` : ''}text into ${targetLanguage} and return only the translated text.\n\nText:\n${sourceText}`;
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
