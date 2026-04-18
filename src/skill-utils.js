const { logInfo, logError, logDebug } = require('./logger');
/**
 * @deprecated
 */
function findPreviousOutputText(context) {
  const candidate = context.stepResults
    .slice()
    .reverse()
    .find((step) => step.output && typeof step.output === 'object' && (step.output.text || step.output.translatedText || step.output.summaryText || step.output.content));
  if (!candidate) {
    return null;
  }
  const output = candidate.output;
  return output.text || output.translatedText || output.summaryText || output.content || null;
}

function findPreviousOutputByKey(context, key) {
  const candidate = context.stepResults
    .slice()
    .reverse()
    .find((step) => step.output && typeof step.output === 'object' && key in step.output);
  if (!candidate) {
    return null;
  }
  return candidate.output[key];
}

function findPreviousOutputForPayload(context, payloadDefinition) {
  // For each key in the payload definition, try to find it in previous step outputs
  const result = {};
  for (const key of Object.keys(payloadDefinition)) {
    const value = findPreviousOutputByKey(context, key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

function stripHtml(html) {
  if (typeof html !== 'string') {
    return '';
  }
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


async function getLanguageFromText(text) {
  const { eld } = await import('eld/large');
  let languageCode = "unknown";
  let languageName = "unknown";
  // Detect language
  let parsed = eld.detect(text);
  if (!parsed || !parsed.language) {

  } else {
    languageCode = parsed.language;
    languageName = getLanguageNameFromLanguageCode(languageCode);
  }
  return {languageCode, languageName};
}

function getLanguageNameFromLanguageCode(languageCode) {
  let languageName = 'unknown';
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
  try {
    languageName = languageNames.of(languageCode);
  } catch (e) {
    logError(`Error happned when get language from code: ${languageCode}\n${e}`);
    languageName = languageCode;
  }
  return languageName;
}

module.exports = {
  findPreviousOutputText,
  findPreviousOutputByKey,
  findPreviousOutputForPayload,
  stripHtml,
  getLanguageFromText,
  getLanguageNameFromLanguageCode
};
