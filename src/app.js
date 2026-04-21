const TaskRepository = require('./task-repository');
const TaskEngine = require('./task-engine');
const inputProvider = require('./input-provider');
const { logInfo, logError, logDebug } = require('./logger');
const llmProvider = require('./llm-provider');
const promptBuilder = require('./prompt-builder');
const { config } = require('./config');

async function handleAdmin(taskRepository) {
  const action = process.argv[3];
  const workflowId = process.argv[4];

  if (!action) {
    throw new Error('Missing admin action.');
  }

  if (action === 'list-workflows') {
    const workflows = await taskRepository.listWorkflows();
    console.log(JSON.stringify(workflows, null, 2));
    return;
  }

  if (!workflowId) {
    throw new Error('Missing workflow id.');
  }

  if (action === 'delete-workflow') {
    const deleted = await taskRepository.deleteWorkflow(workflowId);

    if (!deleted) {
      throw new Error(`Workflow id ${workflowId} not found.`);
    }

    console.log(JSON.stringify({
      ok: true,
      action,
      workflowId: Number(workflowId)
    }, null, 2));
    return;
  }

  if (action === 'disable-workflow') {
    const updated = await taskRepository.updateWorkflowStatus(
      workflowId,
      taskRepository.constructor.WORKFLOW_STATUS.INACTIVE
    );

    if (!updated) {
      throw new Error(`Workflow id ${workflowId} not found.`);
    }

    console.log(JSON.stringify({
      ok: true,
      action,
      workflowId: Number(workflowId),
      status: taskRepository.constructor.WORKFLOW_STATUS.INACTIVE
    }, null, 2));
    return;
  }

  if (action === 'reject-workflow') {
    const updated = await taskRepository.updateWorkflowStatus(
      workflowId,
      taskRepository.constructor.WORKFLOW_STATUS.REJECTED
    );

    if (!updated) {
      throw new Error(`Workflow id ${workflowId} not found.`);
    }

    console.log(JSON.stringify({
      ok: true,
      action,
      workflowId: Number(workflowId),
      status: taskRepository.constructor.WORKFLOW_STATUS.REJECTED
    }, null, 2));
    return;
  }

  if (action === 'activate-workflow') {
    const updated = await taskRepository.updateWorkflowStatus(
      workflowId,
      taskRepository.constructor.WORKFLOW_STATUS.ACTIVE
    );

    if (!updated) {
      throw new Error(`Workflow id ${workflowId} not found.`);
    }

    console.log(JSON.stringify({
      ok: true,
      action,
      workflowId: Number(workflowId),
      status: taskRepository.constructor.WORKFLOW_STATUS.ACTIVE
    }, null, 2));
    return;
  }

  throw new Error(`Unsupported admin action: ${action}`);
}

async function main() {
  try {
    logInfo(`Starting ${config.app.name}`);
    const taskRepository = new TaskRepository();
    await taskRepository.init();

    const command = process.argv[2];

    if (command === 'admin') {
      await handleAdmin(taskRepository);
      process.exit(0);
    }

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

    if (result.status === taskRepository.constructor.TASK_STATUS.COMPLETED) {
      logInfo('Final result:');
      console.log(JSON.stringify(result.finalOutput, null, 2));
      process.exit(0);
    } else if (result.status === taskRepository.constructor.TASK_STATUS.PAUSED) {
      logInfo('Work paused.');
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