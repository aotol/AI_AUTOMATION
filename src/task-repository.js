const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { config } = require('./config');
const { logDebug } = require('./logger');
const path = require('path');
const { promisify } = require('util');

class TaskRepository {
  constructor() {
    const sqlitePath = path.resolve(process.cwd(), config.sqlite.path);
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new sqlite3.Database(sqlitePath);
    this.runAsync = promisify(this.db.run.bind(this.db));
    this.getAsync = promisify(this.db.get.bind(this.db));
    this.allAsync = promisify(this.db.all.bind(this.db));
  }

  // Task Status Constants
  static TASK_STATUS = {
    RECEIVED: 'received',
    PLANNING: 'planning',
    PLAN_VALIDATED: 'plan_validated',
    PLAN_FAILED: 'plan_failed',
    STEP_BUILDING: 'step_building',
    STEP_BUILDING_FAILED: 'step_building_failed',
    STEP_BUILDING_VALIDATED: 'step_building_validated',
    EXECUTING: 'executing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  // Step Status Constants
  static STEP_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    VALIDATION_FAILED: 'validation_failed',
    FAILED: 'failed'
  };

  /**
   * Defines each step and allowed next step
   * @returns 
   */
  static getTaskStatusTransitions() {
    const S = TaskRepository.TASK_STATUS;
    return {
      [S.RECEIVED]: [S.PLANNING],
      [S.PLANNING]: [S.PLAN_VALIDATED, S.PLAN_FAILED],
      [S.PLAN_VALIDATED]: [S.STEP_BUILDING],
      [S.STEP_BUILDING]: [S.STEP_BUILDING_VALIDATED, S.STEP_BUILDING_FAILED],
      [S.STEP_BUILDING_VALIDATED]: [S.EXECUTING],
      [S.EXECUTING]: [S.COMPLETED, S.FAILED],
      [S.COMPLETED]: [],
      [S.FAILED]: [],
      [S.PLAN_FAILED]: [],
      [S.STEP_BUILDING_FAILED]: []
    };
  }

  static getStepStatusTransitions() {
    const S = TaskRepository.STEP_STATUS;
    return {
      [S.PENDING]: [S.RUNNING, S.FAILED],
      [S.RUNNING]: [S.COMPLETED, S.VALIDATION_FAILED, S.FAILED],
      [S.COMPLETED]: [],
      [S.VALIDATION_FAILED]: [],
      [S.FAILED]: []
    };
  }

  async validateTaskStatusTransition(taskId, nextStatus) {
    const row = await this.getAsync('SELECT status FROM tasks WHERE task_id = ?', [taskId]);
    if (!row) {
      throw new Error(`Task not found for status transition: ${taskId}`);
    }
    if (row.status === nextStatus) {
      return;
    }
    const allowed = TaskRepository.getTaskStatusTransitions()[row.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`Invalid task status transition from ${row.status} to ${nextStatus}`);
    }
  }

  async validateStepStatusTransition(stepId, nextStatus) {
    const row = await this.getAsync('SELECT status FROM task_steps WHERE id = ?', [stepId]);
    if (!row) {
      throw new Error(`Step not found for status transition: ${stepId}`);
    }
    if (row.status === nextStatus) {
      return;
    }
    const allowed = TaskRepository.getStepStatusTransitions()[row.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`Invalid step status transition from ${row.status} to ${nextStatus}`);
    }
  }

  async init() {
    logDebug('Initializing SQLite database');
    await this.runAsync(`CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      raw_input TEXT NOT NULL,
      status TEXT NOT NULL,
      plan_json TEXT,
      final_output_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    await this.runAsync(`CREATE TABLE IF NOT EXISTS task_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      requires_ai INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      validation_json TEXT,
      started_at TEXT,
      ended_at TEXT
    )`);

    await this.runAsync(`CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_detail_json TEXT,
      created_at TEXT NOT NULL
    )`);
  }

  async createTask(taskId, rawInput) {
    const now = new Date().toISOString();
    await this.runAsync(
      `INSERT INTO tasks (task_id, raw_input, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [taskId, rawInput, TaskRepository.TASK_STATUS.RECEIVED, now, now]
    );
  }

  async updateTaskStatus(taskId, status) {
    await this.validateTaskStatusTransition(taskId, status);
    const now = new Date().toISOString();
    await this.runAsync(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?`,
      [status, now, taskId]
    );
  }

  async saveTaskPlan(taskId, plan) {
    const payload = JSON.stringify(plan);
    const now = new Date().toISOString();
    await this.runAsync(
      `UPDATE tasks SET plan_json = ?, updated_at = ? WHERE task_id = ?`,
      [payload, now, taskId]
    );
  }

  async saveTaskFinalOutput(taskId, finalOutput) {
    const payload = JSON.stringify(finalOutput);
    const now = new Date().toISOString();
    await this.runAsync(
      `UPDATE tasks SET final_output_json = ?, updated_at = ? WHERE task_id = ?`,
      [payload, now, taskId]
    );
  }

  async saveTaskError(taskId, errorMessage) {
    const now = new Date().toISOString();
    await this.runAsync(
      `UPDATE tasks SET error_message = ?, updated_at = ? WHERE task_id = ?`,
      [errorMessage, now, taskId]
    );
  }

  async createStep(taskId, stepIndex, stepName, requiresAI, inputJson) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO task_steps (task_id, step_index, step_name, requires_ai, status, input_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [taskId, stepIndex, stepName, requiresAI ? 1 : 0, TaskRepository.STEP_STATUS.PENDING, JSON.stringify(inputJson || {})],
        function (error) {
          if (error) {
            return reject(error);
          }
          resolve({ id: this.lastID });
        }
      );
    });
  }

  async startStep(stepId) {
    await this.validateStepStatusTransition(stepId, TaskRepository.STEP_STATUS.RUNNING);
    const now = new Date().toISOString();
    await this.runAsync(
      `UPDATE task_steps SET status = ?, started_at = ? WHERE id = ?`,
      [TaskRepository.STEP_STATUS.RUNNING, now, stepId]
    );
  }

  async updateStepStatus(stepId, status, outputJson, validationJson) {
    await this.validateStepStatusTransition(stepId, status);
    const now = new Date().toISOString();
    const outputText = outputJson ? JSON.stringify(outputJson) : null;
    const validationText = validationJson ? JSON.stringify(validationJson) : null;
    await this.runAsync(
      `UPDATE task_steps SET status = ?, output_json = ?, validation_json = ?, ended_at = ? WHERE id = ?`,
      [status, outputText, validationText, now, stepId]
    );
  }

  async addEvent(taskId, eventType, detail) {
    const now = new Date().toISOString();
    await this.runAsync(
      `INSERT INTO task_events (task_id, event_type, event_detail_json, created_at) VALUES (?, ?, ?, ?)`,
      [taskId, eventType, JSON.stringify(detail || {}), now]
    );
  }
}

module.exports = TaskRepository;
