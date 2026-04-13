# AI Automation Framework

A lightweight, program-controlled AI automation framework built with Node.js. This framework allows AI to fill specific parts of a workflow while maintaining strict program validation and control.

## Features

- **Program-Controlled Workflow**: AI generates plans, but all execution is validated by program code
- **Dynamic Skill Registry**: Easily add new capabilities by dropping skill files into the `src/skills/` directory
- **State Machine**: Robust task and step status management with SQLite persistence
- **Inter-Step Data Flow**: Previous step outputs automatically feed into subsequent steps
- **Local LLM Integration**: Uses Ollama for AI capabilities with reasoning model support
- **Event Tracking**: Comprehensive logging of all task and step events

## Architecture

### Core Components

- **Task Engine**: Orchestrates the analysis → planning → execution workflow
- **Skill Registry**: Dynamic loading of atomic skills from `src/skills/` directory
- **LLM Provider**: Handles communication with Ollama API
- **Task Repository**: SQLite-based persistence with state machine validation
- **Validators**: Program validation of AI outputs before state transitions

### Skill System

Skills are atomic, reusable capabilities that can be combined to solve complex tasks. Each skill defines:

- `stepName`: Unique identifier
- `requiresAI`: Whether the skill needs LLM assistance
- `description`: Human-readable description
- `execute()`: Implementation function
- `validate()`: Output validation function

### Workflow

1. **Analysis**: AI analyzes user input and determines task type/goal
2. **Planning**: AI selects and orders skills needed to complete the task (returns array of skill names)
3. **Execution**: Program executes skills sequentially, validating each step
4. **Output**: Final structured result

### Example

For input: "Fetch https://example.com, extract text, and summarize it"

1. **Analysis** (AI-generated JSON):
```json
{
  "taskType": "generic_task",
  "goal": "Fetch page, extract text, and summarize",
  "canDo": true,
  "inputs": {
    "url": "https://example.com"
  }
}
```

2. **Planning** (AI-generated array):
```json
["fetch_url", "extract_text_from_html", "summarize_text", "format_output"]
```

3. **Execution Plan** (Program-built from array):
```json
{
  "steps": [
    {
      "stepIndex": 1,
      "stepName": "fetch_url",
      "requiresAI": false,
      "payload": { "url": "https://example.com" }
    },
    {
      "stepIndex": 2,
      "stepName": "extract_text_from_html",
      "requiresAI": false,
      "payload": {}
    },
    {
      "stepIndex": 3,
      "stepName": "summarize_text",
      "requiresAI": true,
      "payload": {}
    },
    {
      "stepIndex": 4,
      "stepName": "format_output",
      "requiresAI": false,
      "payload": {}
    }
  ]
}
```

## Installation

### Prerequisites

- Node.js 18+
- Ollama (for AI capabilities)
- SQLite3

### Setup

1. Clone the repository:
```bash
git clone [https://github.com/aotol/AI_AUTOMATION.git](https://github.com/aotol/AI_AUTOMATION.git)
cd ai-automation
```

2. Install dependencies:
```bash
npm install
```

3. Configure Ollama:
```bash
# Pull required models
ollama pull llama3.2:3b  # or your preferred model
```

4. Configure the application:
```bash
cp config.json.example config.json
# Edit config.json with your settings
```

## Configuration

Edit `config.json`:

```json
{
  "llm": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2:3b",
    "timeoutMs": 120000,
    "maxOutputTokens": 4000,
    "maxInputChars": 10000,
    "isReasoningModel": false,
    "reasoningStripMode": "none"
  },
  "sqlite": {
    "path": "data/tasks.db"
  },
  "input": {
    "maxLength": 10000
  },
  "output": {
    "maxLength": 50000
  }
}
```

## Usage

### Basic Usage

```bash
node src/app.js "Fetch https://example.com, extract text, and summarize it"
```

### Programmatic Usage

```javascript
const TaskEngine = require('./src/task-engine');
const services = {
  llmProvider: require('./src/llm-provider'),
  taskRepository: require('./src/task-repository'),
  logger: require('./src/logger')
};

const engine = new TaskEngine(services);
const result = await engine.runTask("Your task description here");
console.log(result);
```

## Adding New Skills

1. Create a new file in `src/skills/` (e.g., `my_skill.js`):
```javascript
module.exports = {
  stepName: 'my_skill',
  requiresAI: false,  // or true
  payloadDefinition: {
    // key: description
    text: 'The input text for processing.',
    url: 'The URL to fetch.'
  },
  description: 'Description of what this skill does',
  execute: async (context, services, stepDefinition) => {
    // Implementation
    return { result: 'output' };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    // Validation logic
    return { valid: errors.length === 0, errors };
  }
};
```

2. The skill will be automatically loaded on next startup.

## Skill payloadDefinition and dynamic payload assignment

- Each skill may define a `payloadDefinition` object that lists the expected payload keys and their descriptions.
- `buildAnalysisPrompt()` uses `payloadDefinition` to tell the LLM which parameters it should try to extract from the user request.
- `TaskEngine` then dynamically fills these payload fields from `analysis.inputs` when creating the execution plan.
- If a parameter is not available from the analysis, the step implementation can still derive it from prior step outputs.

This keeps the system abstract and avoids hardcoding payload values for every individual use case.

## Built-in Skills

- **fetch_url**: Downloads webpage content from a URL
- **extract_text_from_htmll**: Strips HTML tags to get readable text
- **detect_language**: Identifies the language of text
- **translate_text**: Translates text to target language
- **summarize_text**: Creates concise summaries
- **format_output**: Structures final output as JSON

## API Reference

### TaskEngine

#### runTask(rawInput)

Executes a complete task workflow.

**Parameters:**
- `rawInput` (string): User task description

**Returns:**
- Promise resolving to task result object

### Skills Registry

#### getStep(stepName)

Retrieves a skill implementation by name.

#### hasStep(stepName)

Checks if a skill exists.

## Development

### Project Structure

```
src/
├── app.js              # Entry point
├── config.js           # Configuration loading
├── task-engine.js      # Main workflow orchestrator
├── skills.js           # Dynamic skill loader
├── skills/             # Skill implementations
│   ├── fetch_url.js
│   ├── extract_text_from_html.js
│   └── ...
├── skill-utils.js      # Shared skill utilities
├── llm-provider.js     # Ollama integration
├── task-repository.js  # SQLite persistence
├── prompt-builder.js   # AI prompt generation
├── validators.js       # Output validation
└── logger.js           # Logging utilities
```

### Testing

```bash
# Test module loading
node -e "require('./src/skills'); console.log('Modules loaded successfully');"

# Run a test task
node src/app.js "Test task description"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your skill to `src/skills/`
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Troubleshooting

### Common Issues

- **Ollama connection failed**: Ensure Ollama is running and accessible at configured URL
- **Skill not found**: Check that skill file exists in `src/skills/` and exports `stepName`
- **Database errors**: Ensure data directory exists and has write permissions

### Debug Mode

Set environment variable `DEBUG=true` to enable detailed logging.
