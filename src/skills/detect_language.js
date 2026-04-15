const { findPreviousOutputByKey, getLanguageFromText } = require('../skill-utils');
module.exports = {
    stepName: 'detect_language',
    requiresAI: false,
    payloadDefinition: {
        text: 'The input text for language detection.'
    },
    description: 'Detect the language of the given text and return the language name (e.g., English, Chinese, Japanese).',
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
            throw new Error('detect_language step requires payload.text or previous step output.');
        }
        let language = await getLanguageFromText(sourceText);
        let languageCode = language.languageCode;
        let languageName = language.languageName;
        return {
            languageCode,
            languageName,
        };
    },
    validate: async (context, result, stepDefinition) => {
        const errors = [];
        if (!result || typeof result !== 'object') {
            errors.push('detect_language result must be an object.');
        }
        if (!result.languageCode || typeof result.languageCode !== 'string') {
            errors.push('detect_language result must include languageCode string.');
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
};