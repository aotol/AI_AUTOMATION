const skills = require('./skills-loader');

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

function validateStepBuilding(steps) {
  const errors = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('Step building result must be a non-empty array of steps.');
    return { valid: false, errors };
  }
  let count = 0;
  for (const step of steps) {
    if (step.stepIndex != count) {
      errors.push(`Step ${count}'s stepIndx is not in sequential incremental (${step.stepIndex})`);
    }
    if (typeof step.stepName !== 'string') {
      errors.push(`Each step ${count}'s name must be a string.`);
    }
    if (!skills.hasStep(step.stepName)) {
      errors.push(`Step ${count}'s skill '${step.stepName}' is not supported by the implementation registry.`);
    }
    count++;
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
  validatePlannedSkillNames,
  validateStepBuilding,
  validateStepResult
};
