const fs = require('fs');
const path = require('path');

function loadSkills() {
  const registry = {};
  const skillsDir = path.join(__dirname, 'skills');

  if (!fs.existsSync(skillsDir)) {
    return registry;
  }

  const files = fs.readdirSync(skillsDir).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const skillPath = path.join(skillsDir, file);
    const skill = require(skillPath);
    const stepName = skill.stepName || skill.name;

    if (!stepName) {
      throw new Error(`Skill file ${file} must export a stepName property.`);
    }

    registry[stepName] = skill;
  }

  return registry;
}

const registry = loadSkills();

function getStep(stepName) {
  return registry[stepName] || null;
}

function hasStep(stepName) {
  return Boolean(registry[stepName]);
}

module.exports = {
  getStep,
  hasStep,
  registry
};
