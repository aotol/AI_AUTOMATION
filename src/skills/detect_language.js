module.exports = {
    stepName: 'detect_language',
    requiresAI: true,
    payloadDefinition: {
        text: 'The input text for language detection.'
    },
    description: 'Detect the language of the given text and return the language code (e.g., en, zh, fr).',
    execute: async (context, services, stepDefinition) => {
        const { findPreviousOutputByKey } = require('../skill-utils');
        const sourceText = stepDefinition.payload && typeof stepDefinition.payload.text === 'string' && stepDefinition.payload?.text?.trim() != ''
        ? stepDefinition.payload.text : findPreviousOutputByKey(context, "text");
        if (!sourceText) {
            throw new Error('detect_language step requires payload.text or previous step output.');
        }
        const prompt = `Analyze the language of the following text and return ONLY the language code in this format:\n{\n  "languageCode": "en",\n  "languageName": "English"\n}\n\nPossible language codes: en, zh, fr, de, es, ja, ko, ru, ar, pt, hi, vi, etc.\n\nText to analyze:\n${sourceText}`;
        const responseText = await services.llmProvider.generateText(prompt);
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            parsed = {
                languageCode: 'unknown',
                languageName: 'Unknown',
                raw: responseText
            };
        }
        return {
            languageCode: parsed.languageCode || 'unknown',
            languageName: parsed.languageName || 'Unknown',
            raw: responseText
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