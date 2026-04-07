const skills = require('./skills-loader');

function validateAnalysis(analysis) {
  const errors = [];

  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    errors.push('Analysis result must be an object.');
    return { valid: false, errors };
  }

  if (!analysis.taskType || typeof analysis.taskType !== 'string') {
    errors.push('taskType is required and must be a string.');
  }

  if (!analysis.goal || typeof analysis.goal !== 'string') {
    errors.push('goal is required and must be a string.');
  }

  if (typeof analysis.canDo !== 'boolean') {
    errors.push('canDo is required and must be a boolean.');
  }

  if (!analysis.inputs || typeof analysis.inputs !== 'object' || Array.isArray(analysis.inputs)) {
    errors.push('inputs is required and must be an object.');
  }

  return { valid: errors.length === 0, errors };
}

function validatePlannedSkillNames(skillNames) {
  const errors = [];

  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    errors.push('Plan must be a non-empty array of skill names.');
    return { valid: false, errors };
  }

  for (const skillName of skillNames) {
    if (typeof skillName !== 'string') {
      errors.push('Each skill name must be a string.');
      continue;
    }

    if (!skills.hasStep(skillName)) {
      errors.push(`Skill '${skillName}' is not supported by the implementation registry.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateStepResult(result) {
  if (result === undefined || result === null) {
    return { valid: false, errors: ['Step result must not be empty.'] };
  }

  if (typeof result !== 'object') {
    return { valid: false, errors: ['Step result must be an object.'] };
  }

  return { valid: true, errors: [] };
}

module.exports = {
  validateAnalysis,
  validatePlannedSkillNames,
  validateStepResult
};
