const captureModule = require('./capture');
const stateManager = require('./state-manager');
const crypto = require('crypto');

/**
 * Context Engine
 * Gathers window/screen metadata into a strict structured JSON object.
 * Supports Context Freeze Mode for follow-up questions.
 * Supports pre-captured screenshots (captured before showing input window).
 */
class ContextEngine {
  constructor() {
    this.frozenContext = null;
    this.pendingScreenshot = null; // Pre-captured screenshot
    this.pendingFiles = null; // Pre-selected files
  }

  /**
   * Store a pre-captured screenshot to be used in the next buildContext() call.
   */
  setPendingScreenshot(base64) {
    this.pendingScreenshot = base64;
    console.log('[ContextEngine] Pending screenshot stored.');
  }

  /**
   * Clear the pending screenshot without using it
   */
  clearPendingScreenshot() {
    this.pendingScreenshot = null;
  }

  /**
   * Store pre-selected files to be used in the next buildContext() call.
   * @param {Array} files Array of {name, type, data} objects
   */
  setPendingFiles(files) {
    this.pendingFiles = files;
    console.log('[ContextEngine] Pending files stored.');
  }

  /**
   * Clear the pending files without using them
   */
  clearPendingFiles() {
    this.pendingFiles = null;
  }

  /**
   * Builds the structured context object
   * @param {string} question The user's prompt
   * @returns {Promise<object>}
   */
  async buildContext(question) {
    const isFrozen = stateManager.get('contextFreeze');

    // If we are in Context Freeze Mode and have a frozen context, reuse it (update timestamp and question)
    if (isFrozen && this.frozenContext) {
      return {
        ...this.frozenContext,
        timestamp: new Date().toISOString(),
        question: question
      };
    }

    // Use pending screenshot if available, otherwise skip (text-only mode)
    let imageBase64;
    if (this.pendingScreenshot) {
      imageBase64 = this.pendingScreenshot;
      this.pendingScreenshot = null; // Consume it
      console.log('[ContextEngine] Using pre-captured screenshot.');
    } else {
      imageBase64 = null; // No screenshot — text-only mode
      console.log('[ContextEngine] No screenshot — text-only mode.');
    }

    // Use pending files if available, otherwise skip
    let files;
    if (this.pendingFiles) {
      files = this.pendingFiles;
      this.pendingFiles = null; // Consume it
      console.log('[ContextEngine] Using pre-selected files.');
    } else {
      files = null;
    }

    const currentProject = stateManager.get('currentProject') || 'Default';
    const currentProvider = stateManager.get('currentProvider') || 'chatgpt';
    const captureId = crypto.randomUUID();

    const contextObject = {
      timestamp: new Date().toISOString(),
      application: "Unknown",
      window_title: "Unknown",
      project: currentProject,
      provider: currentProvider,
      freeze: isFrozen,
      capture_id: captureId,
      question: question,
      selected_text: "",
      ocr_text: "",
      image_base64: imageBase64,
      files: files
    };

    // If freeze is enabled now, store this context
    if (isFrozen) {
      this.frozenContext = { ...contextObject };
    } else {
      this.frozenContext = null;
    }

    return contextObject;
  }

  /**
   * Manually clears the frozen context
   */
  clearFrozenContext() {
    this.frozenContext = null;
    stateManager.set('contextFreeze', false);
  }
}

module.exports = new ContextEngine();
