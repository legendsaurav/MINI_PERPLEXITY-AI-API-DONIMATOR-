'use strict';
/**
 * task-handler.js — Clean orchestration layer for the autonomous desktop agent.
 *
 * Centralises:
 *  - Task validation and classification
 *  - Agent lifecycle management (spawn, monitor, kill)
 *  - Progress event forwarding to the overlay
 *  - Screenshot coordination (hide UI → capture → deliver)
 *
 * Usage:
 *   const taskHandler = require('./task-handler');
 *   taskHandler.init({ overlayWindow, getWindowHwnds, pythonExe, agentScript });
 *   taskHandler.launch('open This PC');
 *   taskHandler.stop();
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const DEFAULT_MAX_ITERATIONS = 15;

class TaskHandler extends EventEmitter {
  constructor() {
    super();
    this._agentProcess = null;
    this._isRunning = false;
    this._config = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Provide runtime dependencies from index.js so this module stays decoupled
   * from Electron window globals.
   *
   * @param {object}   opts
   * @param {Function} opts.getOverlayWindow  – returns the current overlayWindow (may change)
   * @param {Function} opts.getWindowHwnds    – returns Array<number> of HWNDs to exclude
   * @param {string}   opts.pythonExe         – absolute path to the Python interpreter
   * @param {string}   opts.agentScript       – absolute path to run_agent.py (guider_client.agent launcher)
   */
  init(opts) {
    this._config = {
      getOverlayWindow: opts.getOverlayWindow,
      getWindowHwnds: opts.getWindowHwnds,
      pythonExe: opts.pythonExe,
      agentScript: opts.agentScript,
    };
    console.log('[TaskHandler] Initialised.');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /** Whether the agent subprocess is currently alive. */
  get isRunning() {
    return this._isRunning;
  }

  /**
   * Launch the autonomous agent for a given task string.
   * @param  {string}  task  – the user's task description
   * @param  {number}  [maxIterations=15]
   * @returns {boolean} true if launched, false if already running or config missing
   */
  launch(task, maxIterations = DEFAULT_MAX_ITERATIONS) {
    if (!this._config) {
      console.error('[TaskHandler] Not initialised — call init() first.');
      return false;
    }
    if (this._isRunning) {
      console.log('[TaskHandler] Agent already running, ignoring launch request.');
      return false;
    }

    const { pythonExe, agentScript, getWindowHwnds } = this._config;

    if (!fs.existsSync(pythonExe)) {
      console.error('[TaskHandler] Python venv not found at:', pythonExe);
      return false;
    }
    if (!fs.existsSync(agentScript)) {
      console.error('[TaskHandler] Agent script not found at:', agentScript);
      return false;
    }

    // Collect HWNDs to exclude from capture / UI Automation
    const hwnds = getWindowHwnds();
    const args = [
      '-u', agentScript,
      '--task', task,
      '--max-iterations', String(maxIterations),
    ];
    if (hwnds.length > 0) {
      args.push('--exclude-hwnds', hwnds.join(','));
    }

    console.log(`[TaskHandler] Launching with task: "${task}"`);
    console.log(`[TaskHandler] Exclude HWNDs: ${hwnds.join(', ')}`);

    this._agentProcess = spawn(pythonExe, args, {
      cwd: path.dirname(agentScript),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this._isRunning = true;

    // ── stdout: parse JSON progress lines ──────────────────────────────
    let stdoutBuffer = '';
    this._agentProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const progress = JSON.parse(trimmed);
          console.log(`[TaskHandler] Progress: ${progress.type}`);
          this._forwardProgress(progress);

          if (progress.type === 'agent_complete' || progress.type === 'agent_finished') {
            this._forwardFinished(progress);
          }
        } catch {
          // Not JSON — just log it
          if (trimmed.length > 0) {
            console.log(`[TaskHandler-stdout] ${trimmed}`);
          }
        }
      }
    });

    // ── stderr ──────────────────────────────────────────────────────────
    this._agentProcess.stderr.on('data', (data) => {
      console.error(`[TaskHandler-stderr] ${data.toString().trim()}`);
    });

    // ── exit ────────────────────────────────────────────────────────────
    this._agentProcess.on('close', (code) => {
      console.log(`[TaskHandler] Process exited with code ${code}`);
      this._isRunning = false;
      this._agentProcess = null;
      this._forwardFinished({ type: 'agent_finished', code });
      this.emit('finished', { code });
    });

    // Notify overlay
    this._forwardStarted({ task });
    this.emit('started', { task });

    return true;
  }

  /**
   * Kill the running agent process.
   * @returns {boolean} true if a process was killed
   */
  stop() {
    if (this._agentProcess && this._isRunning) {
      console.log('[TaskHandler] Stopping agent process...');
      this._agentProcess.kill();
      this._isRunning = false;
      this._agentProcess = null;
      this.emit('stopped');
      return true;
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal — Overlay IPC forwarding
  // ──────────────────────────────────────────────────────────────────────────

  /** @private */
  _getOverlay() {
    try {
      const win = this._config?.getOverlayWindow();
      return win && !win.isDestroyed() ? win : null;
    } catch {
      return null;
    }
  }

  /** @private */
  _forwardProgress(progress) {
    const win = this._getOverlay();
    if (win) win.webContents.send('agent-progress', progress);
  }

  /** @private */
  _forwardStarted(data) {
    const win = this._getOverlay();
    if (win) win.webContents.send('agent-started', data);
  }

  /** @private */
  _forwardFinished(data) {
    const win = this._getOverlay();
    if (win) win.webContents.send('agent-finished', data);
  }
}

module.exports = new TaskHandler();
