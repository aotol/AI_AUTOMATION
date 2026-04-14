const crypto = require('crypto');
const {
    config
} = require('./config');
const {
    logInfo,
    logError,
    logDebug
} = require('./logger');
const promptBuilder = require('./prompt-builder');
const validators = require('./validators');
const skills = require('./skills-loader');

class TaskEngine {
    constructor(services) {
        this.services = services;
    }

    async runTask(rawInput) {
        const taskId = crypto.randomUUID();
        const {
            taskRepository,
            logger
        } = this.services;
        logger.logInfo(`Creating task ${taskId}`);
        await taskRepository.createTask(taskId, rawInput);
        await taskRepository.addEvent(taskId, 'task_created', {
            rawInput
        });

        try {
            //Firstly, plan the tasks
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.PLANNING);
            await taskRepository.addEvent(taskId, 'planning_requested');
            logger.logInfo('Starting planning phase');
            const planPrompt = promptBuilder.buildPlanPrompt(rawInput);
            const plannedSkillNames = await this.services.llmProvider.generateJson(planPrompt);
            const plannedSkillNamesValidation = validators.validatePlannedSkillNames(plannedSkillNames);

            if (!plannedSkillNamesValidation.valid) {
                const error = plannedSkillNamesValidation.errors.join(' | ');
                await taskRepository.saveTaskPlan(taskId, plannedSkillNames);
                await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.ASK_STATUS.PLAN_FAILED);
                await taskRepository.addEvent(taskId, 'planning_failed', {
                    errors: plannedSkillNamesValidation.errors
                });
                await taskRepository.saveTaskError(taskId, error);
                logger.logError(`Plan validation failed: ${error}`);
                return {
                    taskId,
                    status: taskRepository.constructor.TASK_STATUS.PLAN_FAILED,
                    error
                };
            }
            await taskRepository.saveTaskPlan(taskId, plannedSkillNames);
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.PLAN_VALIDATED);
            await taskRepository.addEvent(taskId, 'planning_validated');
            logger.logInfo('Plan validated successfully');

            // Secondly, build the plan detials
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.STEP_BUILDING);
            await taskRepository.addEvent(taskId, 'step_building_started');
            logger.logInfo('Starting step building phase');
            const steps = [];
            for (let index = 0; index < plannedSkillNames.length; index++) {
                const skillName = plannedSkillNames[index];
                logger.logInfo(`Building step ${index}.${skillName}...`);
                const skill = skills.getStep(skillName);
                //Assgin payload for each sklll
                let payload = {};
                if (skill.payloadDefinition && Object.keys(skill.payloadDefinition).length > 0) {
                    //This skill requires parameter, now try to capture the parameter value from the rawInput (User input)
                    const fillPayloadParametersPrompt = promptBuilder.buildFillSkillParameterPrompt(rawInput, skill);
                    const filledPayloadParameters = await this.services.llmProvider.generateJson(fillPayloadParametersPrompt);
                    Object.keys(skill.payloadDefinition).forEach(function (key) {
                        if (filledPayloadParameters && Object.prototype.hasOwnProperty.call(filledPayloadParameters, key)) {
                            payload[key] = filledPayloadParameters[key];
                        } else {
                            //The value of the payload is yet avaiable, could becomes avaiallbe during execution
                            logger.logInfo(`Missing key: ${key} when build execution plan ${index}.${skillName}. Need to provide the value during execution.`);
                        }
                    });
                }
                // Add more default payload logic here as needed

                steps.push({
                    stepIndex: index,
                    stepName: skillName,
                    requiresAI: skill ? skill.requiresAI : false,
                    payload
                });
            }

            const stepBuildingValidation = validators.validateStepBuilding(steps);
            if (!stepBuildingValidation.valid) {
                const error = stepBuildingValidation.errors.join(' | ');
                await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.STEP_BUILDING_FAILED);
                await taskRepository.addEvent(taskId, 'step_building_failed', {
                    errors: stepBuildingValidation.errors
                });
                await taskRepository.saveTaskError(taskId, error);
                logger.logError(`Step building validation failed: ${error}`);
                return {
                    taskId,
                    status: taskRepository.constructor.TASK_STATUS.STEP_BUILDING_FAILED,
                    error
                };
            }
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.STEP_BUILDING_VALIDATED);
            await taskRepository.addEvent(taskId, 'step_building_validated');
            logger.logInfo('Step building validated successfully');

            //Thirdly, run the steps
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.EXECUTING);
            await taskRepository.addEvent(taskId, 'execution_started');
            logger.logInfo('Beginning step execution');
            const context = {
                taskId,
                rawInput,
                steps,
                stepResults: []
            };

            for (const stepDefinition of steps) {
                const implementation = skills.getStep(stepDefinition.stepName);
                if (!implementation) {
                    const error = `Unknown step name: ${stepDefinition.stepName}`;
                    await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.FAILED);
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error
                    };
                }

                if (implementation.requiresAI !== stepDefinition.requiresAI) {
                    const error = `Step requiresAI mismatch for ${stepDefinition.stepName}`;
                    await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.FAILED);
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error
                    };
                }

                logger.logInfo(`Executing step ${stepDefinition.stepIndex}: ${stepDefinition.stepName}`);
                const stepRow = await taskRepository.createStep(
                    taskId,
                    stepDefinition.stepIndex,
                    stepDefinition.stepName,
                    stepDefinition.requiresAI,
                    stepDefinition.payload
                );
                await taskRepository.startStep(stepRow.id);
                await taskRepository.addEvent(taskId, 'step_started', {
                    stepIndex: stepDefinition.stepIndex,
                    stepName: stepDefinition.stepName,
                    requiresAI: stepDefinition.requiresAI
                });

                let stepResult;
                try {
                    //Run the step
                    stepResult = await implementation.execute(context, this.services, stepDefinition);
                } catch (error) {
                    const message = `Step execution failed: ${error.message}`;
                    await taskRepository.updateStepStatus(stepRow.id, taskRepository.constructor.STEP_STATUS.FAILED, null, {
                        error: message
                    });
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: message
                    });
                    await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.FAILED);
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error: message
                    };
                }
                //Test if the step result is correct
                const validation = await implementation.validate(context, stepResult, stepDefinition);
                if (!validation.valid) {
                    const message = `Step validation failed: ${validation.errors.join(' | ')}`;
                    await taskRepository.updateStepStatus(stepRow.id, taskRepository.constructor.STEP_STATUS.VALIDATION_FAILED, stepResult, validation);
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: validation.errors
                    });
                    await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.FAILED);
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error: message
                    };
                }

                await taskRepository.updateStepStatus(stepRow.id, taskRepository.constructor.STEP_STATUS.COMPLETED, stepResult, validation);
                await taskRepository.addEvent(taskId, 'step_completed', {
                    stepIndex: stepDefinition.stepIndex,
                    stepName: stepDefinition.stepName
                });
                context.stepResults.push({
                    output: stepResult,
                    validation,
                    stepDefinition: stepDefinition
                });
                logger.logInfo(`Step ${stepDefinition.stepIndex} completed`);
            }

            const finalOutput = {
                taskId,
                plan: plannedSkillNames,
                steps: context.stepResults.map((step) => ({
                    stepName: step.stepDefinition.stepName,
                    output: step.output,
                    validation: step.validation
                }))
            };

            const finalText = JSON.stringify(finalOutput);
            if (finalText.length > config.output.maxLength) {
                throw new Error(`Final output exceeds configured max length of ${config.output.maxLength} characters.`);
            }

            await taskRepository.saveTaskFinalOutput(taskId, finalOutput);
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.TASK_STATUS.COMPLETED);
            await taskRepository.addEvent(taskId, 'task_completed');
            logger.logInfo(`Task ${taskId} completed successfully`);
            return {
                taskId,
                status: taskRepository.constructor.TASK_STATUS.COMPLETED,
                finalOutput
            };
        } catch (error) {
            const message = `Task failed: ${error.message}`;
            await taskRepository.updateTaskStatus(taskId, taskRepository.constructor.constructor.TASK_STATUS.FAILED);
            await taskRepository.addEvent(taskId, 'task_failed', {
                error: message
            });
            await taskRepository.saveTaskError(taskId, message);
            logger.logError(message);
            return {
                taskId,
                status: taskRepository.constructor.TASK_STATUS.FAILED,
                error: message
            };
        }
    }
}

module.exports = TaskEngine;