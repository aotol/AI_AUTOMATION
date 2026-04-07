const { config } = require('./config');
const skills = require('./skills-loader');

function ensurePromptWithinLimit(prompt) {
  const maxChars = config.llm.maxInputChars;
  if (prompt.length > maxChars) {
    throw new Error(`Prompt length ${prompt.length} exceeds configured llm.maxInputChars of ${maxChars}.`);
  }
  return prompt;
}

function formatSkillDescriptions() {
  return Object.entries(skills.registry)
    .map(([name, skill]) => {
      const desc = skill.description || 'No description provided.';
      const payloadDefinition = skill.payloadDefinition ? Object.entries(skill.payloadDefinition).map(
        function ([key, value]) {
            return key + ": " + value;
        }).join(" "): "";
      return `- ${name}: ${desc}Required parameters: [${payloadDefinition}]`;
    })
    .join('\n');
}

function buildAnalysisPrompt(rawInput) {
  const prompt = `You are a helper that converts a user request into a structured analysis object.
Respond with JSON only and no markdown.

Task: ${rawInput}

You have the following available skills:
${formatSkillDescriptions()}

Return a JSON object with:
- taskType: string (use "generic_task")
- goal: short description of the user's goal
- canDo: boolean
- inputs: object containing task (The original task text) and any extracted required parameter names and their values such as text, url, targetLanguage, etc.

If you extracted a value for a required parameter, put it into inputs. e.g.: If it is "url", put it in inputs.url.
If the request requires a skill not in the available list, set canDo to false.

Example output:
{
  "taskType": "generic_task",
  "goal": "Describe what the user wants",
  "canDo": true,
  "inputs": {
    "task": "...",
    "url": "https://example.com/article",
    "targetLanguage": "Chinese"
  }
}
`;
  return ensurePromptWithinLimit(prompt);
}

function buildPlanPrompt(analysis) {
  const prompt = `You are a generic planner for a program-controlled workflow.
Respond with ONLY a JSON array of skill names. No markdown, no explanation, no extra text before or after.

Available skills:
${formatSkillDescriptions()}

Your job: Convert the analysis into an ordered sequence of atomic skill names that the program can execute.
CRITICAL RULES:
- Do not invent new step names
- Use ONLY the available skill names exactly as shown
- Select ONLY the skills needed for the specific task in analysis.goal
- Determine the correct order based on data flow (outputs from earlier steps feed into later steps)
- Return ONLY a JSON array like: ["skill1", "skill2", "skill3"]

Analysis:
${JSON.stringify(analysis, null, 2)}

Example for "Fetch https://example.com, extract text, detect language, and summarize":
["fetch_url", "extract_text_from_html", "detect_language", "summarize_text", "format_output"]

Start your response with [ and end with ]. No other text.
`;
  return ensurePromptWithinLimit(prompt);
}

function buildAIStepPrompt(context, stepDefinition) {
  const previousSteps = context.stepResults.map((step) => ({
    stepIndex: step.stepDefinition.stepIndex,
    stepName: step.stepDefinition.stepName,
    output: step.output
  }));

  const prompt = `You are an AI helper used inside a controlled program workflow. Do not invent new step names or change the workflow.
Respond with a concise result appropriate for the step.

Task analysis:
${JSON.stringify(context.analysis, null, 2)}

Plan step:
${JSON.stringify(stepDefinition, null, 2)}

Previously completed step outputs (available for use in this step):
${JSON.stringify(previousSteps, null, 2)}

If the current step is translate_text:
  - Use the most recent text output from previous steps as the source text
  - If a previous detect_language step exists and has identified the source language, use that context
  - Use payload.targetLanguage if explicitly specified

If the current step is summarize_text:
  - Use the most recent text output from previous steps as the source text

If the step payload contains explicit instructions, follow them.
Return only the requested output of this step.
`;
  return ensurePromptWithinLimit(prompt);
}

module.exports = {
  buildAnalysisPrompt,
  buildPlanPrompt,
  buildAIStepPrompt
};
