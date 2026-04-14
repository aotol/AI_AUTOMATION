const TaskRepository = require('./task-repository');
const TaskEngine = require('./task-engine');
const inputProvider = require('./input-provider');
const { logInfo, logError, logDebug } = require('./logger');
const llmProvider = require('./llm-provider');
const promptBuilder = require('./prompt-builder');
const { config } = require('./config');

async function main() {
  try {
    logInfo(`Starting ${config.app.name}`);
    const taskRepository = new TaskRepository();
    await taskRepository.init();

    const services = {
      config,
      taskRepository,
      llmProvider,
      promptBuilder,
      logger: { logInfo, logError, logDebug }
    };

    const rawInput = inputProvider.getUserInput();
    logInfo(`Received user input: ${rawInput}`);

    const engine = new TaskEngine(services);
    const result = await engine.runTask(rawInput);

    if (result.status === 'completed') {
      logInfo('Final result:');
      console.log(JSON.stringify(result.finalOutput, null, 2));
      process.exit(0);
    }

    logError(`Task ended with status ${result.status}`);
    if (result.error) {
      logError(result.error);
    }
    process.exit(1);
  } catch (error) {
    logError(`Application error: ${error.message}`);
    process.exit(1);
  }
}

main();
