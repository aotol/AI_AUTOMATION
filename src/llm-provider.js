const { jsonrepair } = require('jsonrepair');

const { config } = require('./config');
const { logDebug, logError } = require('./logger');

const MAX_OUTPUT_TOKENS = config.llm.maxOutputTokens || 4000;
const TIMEOUT_MS = config.llm.timeoutMs || 120000;

function buildRequestBody(prompt) {
  const body = {
    model: config.llm.model,
    prompt,
    stream: false,
    options: {
      max_tokens: MAX_OUTPUT_TOKENS
    }
  };

  if (config.llm.apiKey) {
    body.api_key = config.llm.apiKey;
  }

  return body;
}

function parseOllamaResponse(json) {
  if (!json) {
    throw new Error('Empty response from Ollama');
  }

  if (typeof json === 'string') {
    return json;
  }

  if (Array.isArray(json.results) && json.results.length > 0) {
    return json.results.map((item) => item.content).join('\n');
  }

  if (Array.isArray(json.result) && json.result.length > 0) {
    return json.result.map((item) => item.content).join('\n');
  }

  if (typeof json.response === 'string') {
    return json.response;
  }

  if (typeof json.text === 'string') {
    return json.text;
  }

  if (typeof json.output === 'string') {
    return json.output;
  }

  if (typeof json.content === 'string') {
    return json.content;
  }

  return JSON.stringify(json);
}


function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripReasoning(text) {
  if (!config.llm.isReasoningModel || config.llm.reasoningStripMode === 'none') {
    return text;
  }

  if (!text || typeof text !== 'string') {
    return text;
  }

  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) {
    return trimmed;
  }

  const reasoningTags = ['think', 'thinking', 'reflection'];
  let cleaned = trimmed;

  for (const tag of reasoningTags) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const regex = new RegExp(`${escapeRegex(openTag)}[\s\S]*?${escapeRegex(closeTag)}`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  cleaned = cleaned.trim();
  if (/^[\[{]/.test(cleaned)) {
    return cleaned;
  }

  const fenceMatch = cleaned.match(/```json\s*([\s\S]*?)```/i) || cleaned.match(/```([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart !== -1) {
    return cleaned.slice(jsonStart).trim();
  }

  return cleaned;
}

async function callOllama(prompt) {
  const url = `${config.llm.baseUrl.replace(/\/$/, '')}/api/generate`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    logDebug(`Calling Ollama at ${url}`);
    logDebug(`Prompt length: ${prompt.length}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildRequestBody(prompt)),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText} - ${body}`);
    }

    const json = await response.json();
    const rawText = parseOllamaResponse(json);
    const cleaned = stripReasoning(rawText);
    logDebug(`Ollama returned cleaned text: ${cleaned}`);
    return cleaned;
  } catch (error) {
    clearTimeout(timeout);
    logError(`LLM call error: ${error.message}`);
    throw new Error(`LLM call failed: ${error.message}`);
  }
}

async function generateText(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('generateText requires a prompt string');
  }
  return callOllama(prompt);
}

async function generateJson(prompt) {
  const text = await generateText(prompt);
  let result;
  try {
    //Remove unnecessary string outside of JSON
    const firstIndex = text.indexOf("{");
    result = firstIndex !== -1 ? text.substring(firstIndex) : text;
    const lastIndex = result.lastIndexOf("}");
    result = lastIndex !== -1 ? result.substring(0, lastIndex + 1) : result;
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed result is not a JSON object');
    }
    return parsed;
  } catch (error) {
    try {
      const repaired = jsonrepair(result) //Try to fix the problem
      return JSON.parse(repaired);
    } catch(e) {
      throw new Error(`LLM JSON parse failed: ${error.message}\nRaw output: ${text}`);
    }
    
    
  }
}

module.exports = {
  generateText,
  generateJson
};
