module.exports = {
  stepName: 'format_output',
  requiresAI: false,
  payloadDefinition: {},
  description: 'Format and structure the final output as a JSON object.',
  execute: async (context, services) => {
    return {
      input: context.rawInput,
      stepOutputs: context.stepResults.map((step) => ({
        stepIndex: step.stepDefinition.stepIndex,
        stepName: step.stepDefinition.stepName,
        output: step.output
      }))
    };
  },
  validate: async (context, result) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('format_output result must be an object.');
    }
    if (!result.input || typeof result.input !== 'string') {
      errors.push('format_output must include taskType string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
