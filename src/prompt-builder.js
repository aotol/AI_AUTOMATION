const { config } = require('./config');
const skills = require('./skills-loader');

function ensurePromptWithinLimit(prompt) {
  const maxChars = config.llm.maxInputChars;
  if (prompt.length > maxChars) {
    throw new Error(`Prompt length ${prompt.length} exceeds configured llm.maxInputChars of ${maxChars}.`);
  }
  return prompt;
}

function formatAllSkillsDescriptions(includeParameters = false) {
  return Object.entries(skills.registry)
    .map(([name, skill]) => {
      // Temporarily add stepName to skill for formatSkillDescription
      const skillWithName = { ...skill, stepName: name };
      return formatSkillDescription(skillWithName, includeParameters);
    })
    .join('\n');
}

function formatSkillDescription(skill, includeParameters) {
  const desc = skill.description || 'No description provided.';
  const name = skill.stepName;
  let payloadDefinition;
  if (includeParameters) {
    payloadDefinition = skill.payloadDefinition ? Object.entries(skill.payloadDefinition).map(
      function ([key, value]) {
        return key + ": " + value;
      }).join(" "): "";
    }
    return `- ${name}: ${desc}${includeParameters ? ` Required parameters: [${payloadDefinition}]` : ''}`;
}

function buildFillSkillParameterPrompt(rawInput, skill) {
  const prompt = `You are a helper that converts a user request into a structured JSON object.
Respond with JSON only and no markdown.

You have the following available skill:
${formatSkillDescription(skill, true)}

Capture required parameter from the following task then return as a JSON object.
Task: ${rawInput}

Rules:
- If you extracted a value for a required parameter, put it into JSON's object's root level.
- If the task does not contains the value for required parameter, skip this parameter.
- Do not add parameter that is not specified in the skill.
- Only return JSON object, no other text.
`;
  return ensurePromptWithinLimit(prompt);
}

function buildPlanPrompt(task) {
  const prompt = `You are a generic planner for a program-controlled workflow.
Respond with ONLY a JSON array of skill names. No markdown, no explanation, no extra text before or after.

Available skills:
${formatAllSkillsDescriptions(false)}

Your job: Convert the task into an ordered sequence of atomic skill names that the program can execute.
CRITICAL RULES:
- Do not invent new step names
- Use ONLY the available skill names exactly as shown
- Determine the correct order based on data flow (outputs from earlier steps feed into later steps)
- Return ONLY a JSON array like: ["skill1", "skill2", "skill3"]

Example for "Fetch https://example.com, extract text, detect language, and summarize":
["fetch_url", "extract_text_from_html", "detect_language", "summarize_text", "format_output"]

Task: ${task}
`;
  return ensurePromptWithinLimit(prompt);
}

module.exports = {
  buildPlanPrompt,
  buildFillSkillParameterPrompt
};
