const crypto = require('crypto');
const {
    config
} = require('./config');
const promptBuilder = require('./prompt-builder');
const validators = require('./validators');
const skills = require('./skills-loader');
const nspell = require('nspell');

const spellchecker = (function () {
    let spell = null;
    let readyResolve;
    const ready = new Promise((resolve) => {
        readyResolve = resolve;
    });

    // Load dictionary asynchronously because dictionary-en is an ESM module
    import('dictionary-en')
        .then((module) => {
            const dictionary = module.default || module;

            if (typeof dictionary === 'function') {
                dictionary((err, dict) => {
                    if (!err) {
                        spell = nspell(dict);
                    }
                    readyResolve();
                });
            } else if (
                dictionary &&
                typeof dictionary.aff !== 'undefined' &&
                typeof dictionary.dic !== 'undefined'
            ) {
                spell = nspell(dictionary);
                readyResolve();
            } else {
                console.error('dictionary-en returned an unexpected export shape:', dictionary);
                readyResolve();
            }
        })
        .catch((error) => {
            console.error('Failed to load dictionary-en:', error);
            readyResolve();
        });

    return {
        ready,
        isReady: () => !!spell,
        check: (word) => spell ? spell.correct(word) : true,
        suggest: (word) => spell ? spell.suggest(word) : []
    };
})();

class TaskEngine {
    constructor(services) {
        this.services = services;
    }

    async ensureSpellcheckerReady() {
        if (spellchecker.isReady()) {
            return;
        }
        await spellchecker.ready;
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

    async fillParameters(rawInput, registeredSkill) {
        const fillPayloadParametersPrompt = promptBuilder.buildFillSkillParameterPrompt(rawInput, registeredSkill);

        let filledPayloadParameters = await this.services.llmProvider.generateJson(fillPayloadParametersPrompt);

        if (
            filledPayloadParameters &&
            typeof filledPayloadParameters === 'object' &&
            !Array.isArray(filledPayloadParameters) &&
            Object.keys(filledPayloadParameters).length === 1 &&
            filledPayloadParameters[registeredSkill.stepName]
        ) {
            filledPayloadParameters = filledPayloadParameters[registeredSkill.stepName];
        }

        return filledPayloadParameters;
    }

    hasAllExpectedParameters(filledPayloadParameters, expectedParameters) {
        if (
            !filledPayloadParameters ||
            typeof filledPayloadParameters !== 'object' ||
            Array.isArray(filledPayloadParameters)
        ) {
            return false;
        }

        for (let i = 0; i < expectedParameters.length; i++) {
            const key = expectedParameters[i];
            if (!Object.prototype.hasOwnProperty.call(filledPayloadParameters, key)) {
                return false;
            }
        }

        return true;
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

            await this.ensureSpellcheckerReady();
            const normalizedRequestTemplate = this.normalizeRequestTemplate(rawInput);
            let plannedSkills = {};
            let workflowId = null;
            let workflowSource = null;

            const existingWorkflow = await taskRepository.findWorkflowByTemplate(normalizedRequestTemplate);

            if (existingWorkflow && existingWorkflow.status != taskRepository.constructor.WORKFLOW_STATUS.REJECTED) {
                if (existingWorkflow.status == taskRepository.constructor.WORKFLOW_STATUS.ACTIVE) {
                    plannedSkills = existingWorkflow.plannedSkills;
                    workflowId = existingWorkflow.id;
                    workflowSource = 'workflow_cache';

                    await taskRepository.addEvent(taskId, 'planning_reused_workflow', {
                        workflowId,
                        normalizedRequestTemplate,
                        plannedSkills
                    });

                    logger.logInfo(
                        `Reused workflow ${workflowId} for template: ${normalizedRequestTemplate}`
                    );
                } else if (existingWorkflow.status == taskRepository.constructor.WORKFLOW_STATUS.INACTIVE) {
                    logger.logInfo(
                        `An unapproved existing workflow template was found:
Workflow id: ${existingWorkflow.id}
Pattern: ${existingWorkflow.normalizedRequestTemplate}
Workflow:\n${JSON.stringify(existingWorkflow.plannedSkills, null, 2)}
Please approve or reject this workflow template then try again.
To approve, run: 'node app.js admin activate-workflow ${existingWorkflow.id}'
To rejet, run: 'node app.js admin reject-workflow ${existingWorkflow.id}'
To delete, run: 'node app.js admin delete-workflow ${existingWorkflow.id}'
To turn on auto approval for new workflow templates, set config.json's workflow.autoActivate to true
Workflow template will be set to inactive upon failure. To turn it off, set config.json's workflow.autoInactivate to false
`
                    );
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.PAUSED,
                    };
                } else {
                    const unknownWorkflowError = `Unknow WORKFLOW_STATUS: ${existingWorkflow.status}`;
                    logger.logError(unknownWorkflowError);
                    return {
                        taskId,
                        status: taskRepository.constructor.TASK_STATUS.PLAN_FAILED,
                        unknownWorkflowError
                    };
                }
            } else {
                //Plan a new workflow
                let proposedPlannedSkillNames = await this.restrictedPlanningSolution(rawInput);
                const plannedSkillNamesValidation = validators.validatePlannedSkillNames(proposedPlannedSkillNames);
                if (!plannedSkillNamesValidation.valid) {
                    const error = plannedSkillNamesValidation.errors.join(' | ');
                    await taskRepository.saveTaskPlan(taskId, proposedPlannedSkillNames);
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.PLAN_FAILED
                    );
                    await taskRepository.addEvent(taskId, 'planning_failed', {
                        errors: plannedSkillNamesValidation.errors
                    });
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(`Plan skill names validation failed: ${error}`);

                    return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.PLAN_FAILED, error, workflowId});
                }
                workflowSource = 'restricted_planning';

                await taskRepository.addEvent(taskId, 'planning_generated_by_llm', {
                    normalizedRequestTemplate,
                    plannedSkillNames: proposedPlannedSkillNames
                });
                //Convert [skill 1, skill 2, skill 3] formate into:
                //{
                //  skill 1: ["parameter 1 name can be extracted from the input"],
                //  skill 2: ["parameter 1 name can be extracted from the input", "parameter 2 name can be extracted from the input", ...]
                //}
                for (const proposedPlannedSkillName of proposedPlannedSkillNames) {
                    plannedSkills[proposedPlannedSkillName] = []
                }
                logger.logInfo(
                    `Generated plan by restrictedPlanningSolution: ${JSON.stringify(plannedSkills)}`
                );
            }

            const plannedSkillValidation = validators.validatePlannedSkills(plannedSkills);
            if (!plannedSkillValidation.valid) {
                const error = plannedSkillValidation.errors.join(' | ');
                await taskRepository.saveTaskPlan(taskId, plannedSkills);
                await taskRepository.updateTaskStatus(
                    taskId,
                    taskRepository.constructor.TASK_STATUS.PLAN_FAILED
                );
                await taskRepository.addEvent(taskId, 'planning_failed', {
                    errors: plannedSkillValidation.errors
                });
                await taskRepository.saveTaskError(taskId, error);
                logger.logError(`Plan validation failed: ${error}`);

                return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.PLAN_FAILED, error, workflowId});
            }

            await taskRepository.saveTaskPlan(taskId, plannedSkills);
            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.PLAN_VALIDATED
            );
            await taskRepository.addEvent(taskId, 'planning_validated', plannedSkills);
            logger.logInfo(`Plan validated successfully: ${JSON.stringify(plannedSkills)}`);

            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.STEP_BUILDING
            );
            await taskRepository.addEvent(taskId, 'step_building_started');
            logger.logInfo('Starting step building phase');

            const steps = [];
            let newPlannedSkills = {};
            const creatingNewWorkflow = !workflowId;
            const maxFillParameterRetryCount = config.workflow.fillParameter.maxFillParameterRetryCount;
            let savedPlannedSkillEntries = Object.entries(plannedSkills);
            for (let index = 0; index < savedPlannedSkillEntries.length; index++) {
                const savedPlannedSkillEntry = savedPlannedSkillEntries[index];
                const savedPlannedSkillname = savedPlannedSkillEntry[0];

                logger.logInfo(`Building step ${index}.${savedPlannedSkillname}...`);

                const registeredSkill = skills.getStep(savedPlannedSkillname);
                let payload = {};

                if (
                    registeredSkill &&
                    registeredSkill.payloadDefinition &&
                    Object.keys(registeredSkill.payloadDefinition).length > 0
                ) {
                    const expectedParameters = Array.isArray(plannedSkills[savedPlannedSkillname])
                        ? plannedSkills[savedPlannedSkillname]
                        : [];

                    let filledPayloadParameters = null;
                    let attemptCount = 0;

                    do {
                        attemptCount++;
                        filledPayloadParameters = await this.fillParameters(rawInput, registeredSkill);

                        logger.logDebug(
                            `Filled payload ${creatingNewWorkflow ? "" : `(attempt ${attemptCount})`} for ${savedPlannedSkillname}: ${JSON.stringify(filledPayloadParameters, null, 2)}`
                        );

                        if (this.hasAllExpectedParameters(filledPayloadParameters, expectedParameters)) {
                            break;
                        }

                        logger.logDebug(
                            `Skill ${savedPlannedSkillname} failed to extract all expected parameters ${JSON.stringify(expectedParameters)}. Retry ${attemptCount}/${maxFillParameterRetryCount}.`
                        );
                    } while (attemptCount < maxFillParameterRetryCount);

                    if (creatingNewWorkflow && !newPlannedSkills[savedPlannedSkillname]) {
                        newPlannedSkills[savedPlannedSkillname] = [];
                    }

                    if (
                        filledPayloadParameters &&
                        typeof filledPayloadParameters === 'object' &&
                        !Array.isArray(filledPayloadParameters)
                    ) {
                        const parameterKeys = Object.keys(registeredSkill.payloadDefinition);

                        for (let i = 0; i < parameterKeys.length; i++) {
                            const key = parameterKeys[i];

                            try {
                                if (Object.prototype.hasOwnProperty.call(filledPayloadParameters, key)) {
                                    payload[key] = filledPayloadParameters[key];

                                    if (creatingNewWorkflow) {
                                        if (!newPlannedSkills[savedPlannedSkillname].includes(key)) {
                                            newPlannedSkills[savedPlannedSkillname].push(key);
                                        }
                                    }
                                } else {
                                    if (expectedParameters.includes(key)) {
                                        logger.logDebug(
                                            `Parameter: ${key} is declared in savedPlannedSkill: ${savedPlannedSkillname} but still failed to extract after ${attemptCount} attempts.`
                                        );
                                    } else {
                                        logger.logDebug(
                                            `Missing key: ${key} when build execution plan ${index}.${savedPlannedSkillname}. Need to provide the value during execution.`
                                        );
                                    }
                                }
                            } catch (error) {
                                logger.logError(`Step building value assigning failed: ${error}`);
                            }
                        }
                    } else {
                        logger.logDebug(
                            `LLM did not return a valid JSON object for ${savedPlannedSkillname} after ${attemptCount} attempts.`
                        );
                    }
                }

                steps.push({
                    stepIndex: index,
                    stepName: savedPlannedSkillname,
                    requiresAI: registeredSkill ? registeredSkill.requiresAI : false,
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

                return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.STEP_BUILDING_FAILED, error, workflowId});
            }

            await taskRepository.updateTaskStatus(
                taskId,
                taskRepository.constructor.TASK_STATUS.STEP_BUILDING_VALIDATED
            );
            await taskRepository.addEvent(taskId, 'step_building_validated', steps);
            logger.logInfo('Step building validated successfully');

            if (creatingNewWorkflow) {
                let status = config.workflow.autoActivate
                    ? taskRepository.constructor.WORKFLOW_STATUS.ACTIVE
                    : taskRepository.constructor.WORKFLOW_STATUS.INACTIVE;

                workflowId = await taskRepository.createWorkflowTemplate({
                    normalizedRequestTemplate,
                    plannedSkills: newPlannedSkills,
                    source: workflowSource || 'restricted_planning',
                    status
                });

                await taskRepository.addEvent(taskId, 'workflow_created', {
                    workflowId,
                    normalizedRequestTemplate,
                    plannedSkills: newPlannedSkills
                });

                logger.logInfo(`Workflow created with id ${workflowId}`);
            }
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

                    return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.FAILED, error, workflowId});
                }

                if (implementation.requiresAI !== stepDefinition.requiresAI) {
                    const error = `Step requiresAI mismatch for ${stepDefinition.stepName}`;
                    await taskRepository.updateTaskStatus(
                        taskId,
                        taskRepository.constructor.TASK_STATUS.FAILED
                    );
                    await taskRepository.saveTaskError(taskId, error);
                    logger.logError(error);

                    return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.FAILED, error, workflowId});
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

                    return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.FAILED, error: message, workflowId});
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

                    return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.FAILED, error: message, workflowId});
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
                plan: plannedSkills,
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

            return await this.buildErrorReturnPackage({taskId, status: taskRepository.constructor.TASK_STATUS.FAILED, error: message, workflowId});
        }
    }

    normalizeRequestTemplate(rawInput) {
        if (!rawInput || typeof rawInput !== 'string') {
            return '';
        }

        let normalized = rawInput;

        // Only run if the dictionary has finished loading
        if (spellchecker.isReady()) {
            // Split by whitespace to preserve the original structure
            const parts = normalized.split(/(\s+)/);

            const correctedParts = parts.map(part => {
                if (!part.trim()) return part; // Skip whitespace

                // Remove punctuation just for the check (e.g., "word." -> "word")
                const cleanWord = part.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
                const shouldSpellcheck =/^[a-zA-Z]+$/.test(cleanWord) && cleanWord.length >= 3 && cleanWord.length <= 20;

                if (shouldSpellcheck && cleanWord.length > 0 && !spellchecker.check(cleanWord)) {
                    const suggestions = spellchecker.suggest(cleanWord);
                    if (Array.isArray(suggestions) && suggestions.length > 0) {
                        return part.replace(cleanWord, suggestions[0]);
                    }
                }
                return part;
            });

            normalized = correctedParts.join('');
        }
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

        return normalized.toLowerCase().trim();
    }

    async buildErrorReturnPackage({workflowId, taskId, status, error}) {
        const {
            taskRepository,
        } = this.services;
        if (workflowId && config.workflow.autoInactivate) {
            await taskRepository.updateWorkflowStatus(workflowId, taskRepository.constructor.WORKFLOW_STATUS.INACTIVE);
        }
        let returnObject= {
            taskId,
            status,
            error
        }
        return returnObject;
    }
}

module.exports = TaskEngine;