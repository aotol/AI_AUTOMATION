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

module.exports = {
  findPreviousOutputText,
  findPreviousOutputByKey,
  stripHtml
};
