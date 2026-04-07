module.exports = {
  stepName: 'format_output',
  requiresAI: false,
  payloadDefinition: {},
  description: 'Format and structure the final output as a JSON object.',
  execute: async (context, services) => {
    return {
      taskType: context.analysis.taskType,
      goal: context.analysis.goal,
      input: context.analysis.inputs,
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
    if (!result.taskType || typeof result.taskType !== 'string') {
      errors.push('format_output must include taskType string.');
    }
    if (!result.goal || typeof result.goal !== 'string') {
      errors.push('format_output must include goal string.');
    }
    return { valid: errors.length === 0, errors };
  }
};
