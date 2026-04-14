# AI Automation Framework

A lightweight, program-controlled(Harness) AI automation framework built with Node.js. This framework allows AI to fill specific parts of a workflow while maintaining strict program validation and control.

## Features

- **Program-Controlled Workflow**: AI generates plans, but all execution is validated by program code
- **Dynamic Skill Registry**: Easily add new capabilities by dropping skill files into the `src/skills/` directory
- **State Machine**: Robust task and step status management with SQLite persistence
- **Inter-Step Data Flow**: Previous step outputs automatically feed into subsequent steps
- **Local LLM Integration**: Uses Ollama for AI capabilities with reasoning model support
- **Event Tracking**: Comprehensive logging of all task and step events

## Architecture

### Core Components

- **Task Engine**: Orchestrates the planning → building steps → execution workflow
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

1. **Planning**: AI analyzes user input and selects & orders the skills needed to complete the task (returns array of skill names)
2. **Building Steps**: AI fills in the parameters required by each planned skill based on user input and payload definitions
3. **Execution**: Program executes skills sequentially with filled parameters, validating each step
4. **Output**: Final structured result

### Example

For input: "Fetch https://example.com, extract text, and summarize it"

1. **Planning Phase** (AI-generated array of skills):
```json
["fetch_url", "extract_text_from_html", "summarize_text", "format_output"]
```

2. **Building Steps Phase** (AI fills in parameters for each skill):
```json
{
  "steps": [
    {
      "stepIndex": 0,
      "stepName": "fetch_url",
      "requiresAI": false,
      "payload": { "url": "https://example.com" }
    },
    {
      "stepIndex": 1,
      "stepName": "extract_text_from_html",
      "requiresAI": false,
      "payload": {}
    },
    {
      "stepIndex": 2,
      "stepName": "summarize_text",
      "requiresAI": true,
      "payload": { "maxLength": "200 words" }
    },
    {
      "stepIndex": 3,
      "stepName": "format_output",
      "requiresAI": false,
      "payload": {}
    }
  ]
}
```

3. **Execution Phase** (Program executes each step sequentially with filled parameters, validating results)

## Installation

### Prerequisites

- Node.js 18+
- Ollama (for AI capabilities)
- SQLite3

### Setup

1. Clone the repository:
```bash
git clone https://github.com/aotol/AI_AUTOMATION.git
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
# Edit config.json with your settings
```

**Email Configuration** (if using email skills):
- Yahoo Mail IMAP: `imap.mail.yahoo.com:993`
- Yahoo Mail SMTP: `smtp.mail.yahoo.com:465`
- Gmail IMAP: `imap.gmail.com:993` (requires 2FA app password)
- Gmail SMTP: `smtp.gmail.com:465` (requires 2FA app password)

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
  },
  "email": {
    "provider": "smtp",
    "smtp": {
      "name": "AI Automation Framework",
      "host": "smtp.mail.yahoo.com",
      "port": 465,
      "secure": true,
      "auth": {
        "user": "your-email@yahoo.com",
        "pass": "your-app-password"
      }
    },
    "imap": {
      "user": "your-email@yahoo.com",
      "pass": "your-app-password",
      "host": "imap.mail.yahoo.com",
      "port": 993,
      "tls": true
    }
  }
}
```

**Email Setup Notes:**
- Use app-specific passwords for Yahoo Mail and Gmail (not your regular password)
- For Gmail, enable 2FA and generate an app password
- For Yahoo Mail, generate an app password from Account Security settings
- The `pass` field is used for both SMTP and IMAP authentication

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
- `buildFillSkillParameterPrompt()` uses `payloadDefinition` to tell the LLM which parameters it should try to extract from the user input for each step.
- During the Building Steps phase, the LLM is prompted to fill in these payload fields based on the user's raw input and the skill's parameter requirements.
- If a parameter is not available from the user input, the step implementation can still derive it from prior step outputs using `findPreviousOutputForPayload()`.

This keeps the system abstract and avoids hardcoding payload values for every individual use case.

## Built-in Skills

- **fetch_url**: Downloads webpage content from a URL
- **extract_text_from_html**: Strips HTML tags to get readable text
- **detect_language**: Identifies the language of text
- **translate_text**: Translates text to target language
- **summarize_text**: Creates concise summaries
- **receive_email**: Retrieves latest emails from IMAP inbox
- **send_email**: Sends emails via SMTP
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
