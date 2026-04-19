const crypto = require('crypto');
const {
    config
} = require('./config');
const promptBuilder = require('./prompt-builder');
const validators = require('./validators');
const skills = require('./skills-loader');
const sc = require('string-comparison').default;

class TaskEngine {
    constructor(services) {
        this.services = services;
    }

    /**
     * Let LLM to only return the list of skills available for given task
     * Pro: The return skills are from the skill list
     * Con: May miss required skill to complete the task
     * @param {*} rawInput 
     */
    async restrictedPlanningSolution(rawInput) {
        const planPrompt = promptBuilder.buildPlanPrompt(rawInput);
        let plannedSkillNames = await this.services.llmProvider.generateJson(planPrompt);
        let index = 0;
        for (const plannedSkillName of plannedSkillNames) {
            if (plannedSkillName && plannedSkillName.indexOf(":") > -1) {
                plannedSkillNames[index] = plannedSkillName.substring(0, plannedSkillName.indexOf(":"));
            }
            index++;
        }
        return plannedSkillNames;
    }

    /**
     * Let LLM to freely break the task into atomic steps
     * Pro: Less likely to miss required steps
     * Con: May return unpredictable steps names, hard to map to avaiallbe skills
     * @param {*} rawInput 
     * @returns 
     * @deprecated
     */
    async unrestrictedPlanningSolution(rawInput) {
        const analysisPrompt = promptBuilder.buildAnalysisPrompt(rawInput);
        const atomicSteps = await this.services.llmProvider.generateJson(analysisPrompt);
        let plannedSkillNames = [];
        if (!atomicSteps || !Array.isArray(atomicSteps) || atomicSteps.length === 0) {} else {
            plannedSkillNames = await this.mapAtomicStepsToSkills(atomicSteps);
        }
        return plannedSkillNames;
    }

    async mapAtomicStepsToSkills(atomicSteps) {
        const {
            logger,
            llmProvider
        } = this.services;

        const plannedSkillNames = [];
        const skillEntries = Object.entries(skills.registry);
        const skillDetails = [];

        for (const [skillName, skillDefinition] of skillEntries) {
            const skillDetail = `${skillName}: ${skillDefinition.description}`;
            skillDetails.push(skillDetail);
        }

        for (const atomicStep of atomicSteps) {
            const algorithm = sc.diceCoefficient;
            const results = algorithm.sortMatch(atomicStep, skillDetails);

            let bestMatch = null;
            let foundSkill = null;

            if (Array.isArray(results) && results.length > 0) {
                bestMatch = results[results.length - 1];
            }

            if (
                bestMatch &&
                bestMatch.member &&
                bestMatch.member.length > 0 &&
                bestMatch.rating > 0.3
            ) {
                const separatorIndex = bestMatch.member.indexOf(':');
                if (separatorIndex > -1) {
                    foundSkill = bestMatch.member.substring(0, separatorIndex).trim();
                } else {
                    foundSkill = bestMatch.member.trim();
                }
            } else {
                logger.logDebug(
                    `string-comparison cannot find matched skill for atomicStep: ${atomicStep}. Pass down to LLM processing.`
                );

                const findSkillPrompt = promptBuilder.buildFindSkillPrompt(atomicStep);
                let llmFoundSkill = await llmProvider.generateText(findSkillPrompt);

                if (llmFoundSkill) {
                    if (llmFoundSkill.indexOf(':') > -1) {
                        llmFoundSkill = llmFoundSkill.substring(0, llmFoundSkill.indexOf(':'));
                    }

                    llmFoundSkill = llmFoundSkill.trim();

                    if (llmFoundSkill === '""' || llmFoundSkill.length === 0) {
                        llmFoundSkill = null;
                    }
                }

                foundSkill = llmFoundSkill;
            }

            if (foundSkill) {
                const lastPlannedSkillName = plannedSkillNames[plannedSkillNames.length - 1];
                if (lastPlannedSkillName !== foundSkill) {
                    plannedSkillNames.push(foundSkill);
                    logger.logDebug(
                        `mapAtomicStepsToSkills found matched skill: ${foundSkill} for atomicStep: ${atomicStep}`
                    );
                }
            } else {
                logger.logDebug(
                    `mapAtomicStepsToSkills cannot find matched skill for atomicStep: ${atomicStep}`
                );
            }
        }

        return plannedSkillNames;
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
            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.PLANNING
            );
            await taskRepository.addEvent(taskId, 'planning_requested');
            logger.logInfo('Starting planning phase');

            const normalizedRequestTemplate = this.normalizeRequestTemplate(rawInput);
            let plannedSkillNames = [];
            let workflowId = null;
            let workflowSource = null;

            const existingWorkflow = await taskRepository.findActiveWorkflowByTemplate(normalizedRequestTemplate);

            if (existingWorkflow && Array.isArray(existingWorkflow.plannedSkillNames)) {
                plannedSkillNames = existingWorkflow.plannedSkillNames;
                workflowId = existingWorkflow.id;
                workflowSource = 'workflow_cache';

                await taskRepository.addEvent(taskId, 'planning_reused_workflow', {
                    workflowId,
                    normalizedRequestTemplate,
                    plannedSkillNames
                });

                logger.logInfo(
                    `Reused workflow ${workflowId} for template: ${normalizedRequestTemplate}`
                );
            } else {
                plannedSkillNames = await this.restrictedPlanningSolution(rawInput);
                workflowSource = 'restricted_planning';

                await taskRepository.addEvent(taskId, 'planning_generated_by_llm', {
                    normalizedRequestTemplate,
                    plannedSkillNames
                });

                logger.logInfo(
                    `Generated plan by restrictedPlanningSolution: [${plannedSkillNames}]`
                );
            }

            const plannedSkillNamesValidation = validators.validatePlannedSkillNames(plannedSkillNames);
            if (!plannedSkillNamesValidation.valid) {
                const error = plannedSkillNamesValidation.errors.join(' | ');
                await taskRepository.saveTaskPlan(taskId, plannedSkillNames);
                await taskRepository.updateTaskStatus(
                    taskId,
                    taskRepository.constructor.TASK_STATUS.PLAN_FAILED
                );
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
            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.PLAN_VALIDATED
            );
            await taskRepository.addEvent(taskId, 'planning_validated', plannedSkillNames);
            logger.logInfo(`Plan validated successfully: [${plannedSkillNames}]`);
            if (!workflowId) {
                workflowId = await taskRepository.createWorkflowTemplate({
                    normalizedRequestTemplate,
                    plannedSkillNames,
                    source: workflowSource || 'restricted_planning',
                    status: taskRepository.constructor.WORKFLOW_STATUS.ACTIVE
                });

                await taskRepository.addEvent(taskId, 'workflow_created', {
                    workflowId,
                    normalizedRequestTemplate,
                    plannedSkillNames
                });

                logger.logInfo(`Workflow created with id ${workflowId}`);
            }

            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.STEP_BUILDING
            );
            await taskRepository.addEvent(taskId, 'step_building_started');
            logger.logInfo('Starting step building phase');

            const steps = [];

            for (let index = 0; index < plannedSkillNames.length; index++) {
                const skillName = plannedSkillNames[index];
                logger.logInfo(`Building step ${index}.${skillName}...`);

                const skill = skills.getStep(skillName);
                let payload = {};

                if (skill && skill.payloadDefinition && Object.keys(skill.payloadDefinition).length > 0) {
                    const fillPayloadParametersPrompt =
                        promptBuilder.buildFillSkillParameterPrompt(rawInput, skill);

                    let filledPayloadParameters =
                        await this.services.llmProvider.generateJson(fillPayloadParametersPrompt);

                    if (filledPayloadParameters && Object.keys(filledPayloadParameters) == 1 && filledPayloadParameters[skillName]) {
                        //Sometimes the LLM may put he skill name as the top level JSON object
                        filledPayloadParameters = filledPayloadParameters[skillName];
                    }

                    logger.logDebug(`Filled payload: ${JSON.stringify(filledPayloadParameters)}`);

                    Object.keys(skill.payloadDefinition).forEach((key) => {
                        try {
                            if (
                                filledPayloadParameters &&
                                Object.prototype.hasOwnProperty.call(filledPayloadParameters, key)
                            ) {
                                payload[key] = filledPayloadParameters[key];
                            } else {
                                logger.logDebug(
                                    `Missing key: ${key} when build execution plan ${index}.${skillName}. Need to provide the value during execution.`
                                );
                            }
                        } catch (error) {
                            logger.logError(`Step building value assigning failed: ${error}`);
                        }
                    });
                }

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
                await taskRepository.updateTaskStatus(
                    taskId,
                    taskRepository.constructor.TASK_STATUS.STEP_BUILDING_FAILED
                );
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

            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.STEP_BUILDING_VALIDATED
            );
            await taskRepository.addEvent(taskId, 'step_building_validated', steps);
            logger.logInfo('Step building validated successfully');

            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.EXECUTING
            );
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
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.FAILED
                    );
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
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.FAILED
                    );
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);

                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error
                    };
                }

                logger.logInfo(
                    `Executing step ${stepDefinition.stepIndex}: ${stepDefinition.stepName}`
                );

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
                    stepResult = await implementation.execute(
                        context,
                        this.services,
                        stepDefinition
                    );
                } catch (error) {
                    const message = `Step execution failed: ${error.message}`;
                    await taskRepository.updateStepStatus(
                        stepRow.id,
                        taskRepository.constructor.STEP_STATUS.FAILED,
                        null, {
                            error: message
                        }
                    );
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: message
                    });
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.FAILED
                    );
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);

                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error: message
                    };
                }

                const validation = await implementation.validate(
                    context,
                    stepResult,
                    stepDefinition
                );

                if (!validation.valid) {
                    const message = `Step validation failed: ${validation.errors.join(' | ')}`;
                    await taskRepository.updateStepStatus(
                        stepRow.id,
                        taskRepository.constructor.STEP_STATUS.VALIDATION_FAILED,
                        stepResult,
                        validation
                    );
                    await taskRepository.addEvent(taskId, 'step_failed', {
                        stepIndex: stepDefinition.stepIndex,
                        stepName: stepDefinition.stepName,
                        error: validation.errors
                    });
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.FAILED
                    );
                    await taskRepository.saveTaskError(taskId, message);
                    logger.logError(message);

                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.FAILED,
                        error: message
                    };
                }

                await taskRepository.updateStepStatus(
                    stepRow.id,
                    taskRepository.constructor.STEP_STATUS.COMPLETED,
                    stepResult,
                    validation
                );
                await taskRepository.addEvent(taskId, 'step_completed', {
                    stepIndex: stepDefinition.stepIndex,
                    stepName: stepDefinition.stepName
                });

                context.stepResults.push({
                    output: stepResult,
                    validation,
                    stepDefinition
                });

                logger.logInfo(`Step ${stepDefinition.stepIndex} completed`);
            }

            const finalOutput = {
                taskId,
                workflowId,
                workflowSource,
                normalizedRequestTemplate,
                plan: plannedSkillNames,
                steps: context.stepResults.map((step) => ({
                    stepName: step.stepDefinition.stepName,
                    output: step.output,
                    validation: step.validation
                }))
            };
            const finalText = JSON.stringify(finalOutput);

            if (finalText.length > config.output.maxLength) {
                throw new Error(
                    `Final output exceeds configured max length of ${config.output.maxLength} characters.`
                );
            }

            await taskRepository.saveTaskFinalOutput(taskId, finalOutput);
            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.COMPLETED
            );
            await taskRepository.addEvent(taskId, 'task_completed');
            logger.logInfo(`Task ${taskId} completed successfully`);

            return {
                taskId,
                status: taskRepository.constructor.TASK_STATUS.COMPLETED,
                finalOutput
            };
        } catch (error) {
            const message = `Task failed: ${error.message}`;
            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.FAILED
            );
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

    normalizeRequestTemplate(rawInput) {
        if (!rawInput || typeof rawInput !== 'string') {
            return '';
        }

        let normalized = rawInput;

        // Normalize line breaks and tabs first
        normalized = normalized.replace(/[\r\n\t]+/g, ' ');

        // email first, so email domain is not mistaken as URL
        normalized = normalized.replace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            '<EMAIL>'
        );

        // URL / domain / www / domain with optional path
        normalized = normalized.replace(
            /\b((https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}([\/?#][^\s]*)?)\b/gi,
            '<URL>'
        );

        // quoted string with double quotes
        normalized = normalized.replace(/"([^"\\]|\\.)*"/g, '"<STRING>"');

        // quoted string with single quotes
        normalized = normalized.replace(/'([^'\\]|\\.)*'/g, '\'<STRING>\'');

        // number after colon
        normalized = normalized.replace(/(:\s*)-?\d+(\.\d+)?\b/g, '$1<NUMBER>');

        // number after equal sign
        normalized = normalized.replace(/(=\s*)-?\d+(\.\d+)?\b/g, '$1<NUMBER>');

        // remaining standalone numbers
        normalized = normalized.replace(/\b-?\d+(\.\d+)?\b/g, '<NUMBER>');

        // Normalize spaces around punctuation
        normalized = normalized.replace(/\s*:\s*/g, ': ');
        normalized = normalized.replace(/\s*,\s*/g, ', ');
        normalized = normalized.replace(/\s*;\s*/g, '; ');
        normalized = normalized.replace(/\s*\(\s*/g, '(');
        normalized = normalized.replace(/\s*\)\s*/g, ')');
        normalized = normalized.replace(/\s*\{\s*/g, '{');
        normalized = normalized.replace(/\s*\}\s*/g, '}');
        normalized = normalized.replace(/\s*\[\s*/g, '[');
        normalized = normalized.replace(/\s*\]\s*/g, ']');

        // Collapse spaces again after punctuation normalization
        normalized = normalized.replace(/\s+/g, ' ').trim();

        return normalized;
    }
}

module.exports = TaskEngine;