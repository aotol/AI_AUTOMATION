const skills = require('./skills-loader');

function validatePlannedSkillNames(skillNames) {
  const errors = [];

  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    errors.push('AI_AUTOMATION does not have enough skill to carry out this task.');
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

function validatePlannedSkills(plannedSkills) {
  const errors = [];

  if (typeof plannedSkills !== 'object') {
    errors.push('Planned skill object must be a JSON object.');
    return { valid: false, errors };
  }
  const plannedSkillNames = Object.keys(plannedSkills);
  if (!Array.isArray(plannedSkillNames) || plannedSkillNames.length === 0) {
    errors.push('AI_AUTOMATION does not have enough skill to carry out this task.');
    return { valid: false, errors };
  }

  for (const plannedSkillName of plannedSkillNames) {
    if (typeof plannedSkills[plannedSkillName] !== 'object') {
      errors.push('Each planned skill must be a JSON object.');
      continue;
    }
    if (!skills.hasStep(plannedSkillName)) {
      errors.push(`Skill '${plannedSkillName}' is not supported by the implementation registry.`);
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
  validatePlannedSkills,
  validateStepBuilding,
  validateStepResult
};
