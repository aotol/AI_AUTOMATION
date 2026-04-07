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
            //Firstly, analyze the task
            await taskRepository.updateTaskStatus(taskId, 'analyzing');
            await taskRepository.addEvent(taskId, 'analysis_requested');
            logger.logInfo('Starting analysis phase');

            const analysisPrompt = promptBuilder.buildAnalysisPrompt(rawInput);
            //Convert user request into JSON
            const analysis = await this.services.llmProvider.generateJson(analysisPrompt);
            const analysisValidation = validators.validateAnalysis(analysis);

            if (!analysisValidation.valid) {
                const error = analysisValidation.errors.join(' | ');
                await taskRepository.saveTaskAnalysis(taskId, analysis);
                await taskRepository.updateTaskStatus(taskId, 'analysis_failed');
                await taskRepository.addEvent(taskId, 'analysis_failed', {
                    errors: analysisValidation.errors
                });
                await taskRepository.saveTaskError(taskId, error);
                logger.logError(`Analysis validation failed: ${error}`);
                return {
                    taskId,
                    status: 'analysis_failed',
                    error
                };
            }

            await taskRepository.saveTaskAnalysis(taskId, analysis);
            await taskRepository.updateTaskStatus(taskId, 'analysis_validated');
            await taskRepository.addEvent(taskId, 'analysis_validated');
            logger.logInfo('Analysis validated successfully');

            //Secondly, plan the tasks
            await taskRepository.updateTaskStatus(taskId, 'planning');
            await taskRepository.addEvent(taskId, 'planning_requested');
            logger.logInfo('Starting planning phase');
            const planPrompt = promptBuilder.buildPlanPrompt(analysis);
            const plannedSkillNames = await this.services.llmProvider.generateJson(planPrompt);
            const plannedSkillNamesValidation = validators.validatePlannedSkillNames(plannedSkillNames);

            if (!plannedSkillNamesValidation.valid) {
                const error = plannedSkillNamesValidation.errors.join(' | ');
                await taskRepository.saveTaskPlan(taskId, plannedSkillNames);
                await taskRepository.updateTaskStatus(taskId, 'plan_failed');
                await taskRepository.addEvent(taskId, 'planning_failed', {
                    errors: plannedSkillNamesValidation.errors
                });
                await taskRepository.saveTaskError(taskId, error);
                logger.logError(`Plan validation failed: ${error}`);
                return {
                    taskId,
                    status: 'plan_failed',
                    error
                };
            }

            // Build plan.steps from skill names array
            const plan = {
                //Build stepDefinition
                steps: plannedSkillNames.map((skillName, index) => {
                    logger.logInfo(`Building execution plan ${index}.${skillName}...`);
                    const skill = skills.getStep(skillName);
                    let payload = {};
                    if (skill.payloadDefinition && Object.keys(skill.payloadDefinition).length > 0) {
                        Object.keys(skill.payloadDefinition).forEach(function (key) {
                            if (analysis.inputs && Object.prototype.hasOwnProperty.call(analysis.inputs, key)) {
                                payload[key] = analysis.inputs[key];
                            } else {
                                //The value of the payload is yet avaiable, could becomes avaiallbe during execution
                                logger.logInfo(`Missing key: ${key} when build execution plan ${index}.${skillName}. Need to provide the value during execution.`);
                            }
                        });
                    }
                    // Add more default payload logic here as needed

                    return {
                        stepIndex: index + 1,
                        stepName: skillName,
                        requiresAI: skill ? skill.requiresAI : false,
                        payload
                    };
                })
            };

            await taskRepository.saveTaskPlan(taskId, plan);
            await taskRepository.updateTaskStatus(taskId, 'plan_validated');
            await taskRepository.addEvent(taskId, 'planning_validated');
            logger.logInfo('Plan validated successfully');

            await taskRepository.updateTaskStatus(taskId, 'executing');
            await taskRepository.addEvent(taskId, 'execution_started');
            logger.logInfo('Beginning step execution');
            const context = {
                taskId,
                rawInput,
                analysis,
                plan,
                stepResults: []
            };

            //Thirdly, run the plan step by step
            for (const stepDefinition of plan.steps) {
                const implementation = skills.getStep(stepDefinition.stepName);
                if (!implementation) {
                    const error = `Unknown step name: ${stepDefinition.stepName}`;
                    await taskRepository.updateTaskStatus(taskId, 'failed');
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);
                    return {
                        taskId,
                        status: 'failed',
                        error
                    };
                }

                if (implementation.requiresAI !== stepDefinition.requiresAI) {
                    const error = `Step requiresAI mismatch for ${stepDefinition.stepName}`;
                    await taskRepository.updateTaskStatus(taskId, 'failed');
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);
                    return {
                        taskId,
                        status: 'failed',
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
                    await taskRepository.updateStepStatus(stepRow.id, 'failed', null, {
                        error: message
                    });
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: message
                    });
                    await taskRepository.updateTaskStatus(taskId, 'failed');
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);
                    return {
                        taskId,
                        status: 'failed',
                        error: message
                    };
                }
                //Test if the step result is correct
                const validation = await implementation.validate(context, stepResult, stepDefinition);
                if (!validation.valid) {
                    const message = `Step validation failed: ${validation.errors.join(' | ')}`;
                    await taskRepository.updateStepStatus(stepRow.id, 'validation_failed', stepResult, validation);
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: validation.errors
                    });
                    await taskRepository.updateTaskStatus(taskId, 'failed');
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);
                    return {
                        taskId,
                        status: 'failed',
                        error: message
                    };
                }

                await taskRepository.updateStepStatus(stepRow.id, 'completed', stepResult, validation);
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
                analysis,
                plan,
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
            await taskRepository.updateTaskStatus(taskId, 'completed');
            await taskRepository.addEvent(taskId, 'task_completed');
            logger.logInfo(`Task ${taskId} completed successfully`);
            return {
                taskId,
                status: 'completed',
                finalOutput
            };
        } catch (error) {
            const message = `Task failed: ${error.message}`;
            await taskRepository.updateTaskStatus(taskId, 'failed');
            await taskRepository.addEvent(taskId, 'task_failed', {
                error: message
            });
            await taskRepository.saveTaskError(taskId, message);
            logger.logError(message);
            return {
                taskId,
                status: 'failed',
                error: message
            };
        }
    }
}

module.exports = TaskEngine;