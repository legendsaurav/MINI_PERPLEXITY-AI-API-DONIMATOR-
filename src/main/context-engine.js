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
    this.pendingImageMeta = null;  // { width, height, displayIndex } of pendingScreenshot
    this.pendingFiles = null;      // Files attached via the file-attach shortcut
  }

  /**
   * Store a pre-captured screenshot to be used in the next buildContext() call.
   * This is used when we capture the screen BEFORE showing the input window,
   * so the input window itself doesn't appear in the screenshot.
   * @param {string} base64 The screenshot as a base64 data URL
   */
  setPendingScreenshot(base64, meta = null) {
    this.pendingScreenshot = base64;
    this.pendingImageMeta = meta; // { width, height, displayIndex } or null
    console.log('[ContextEngine] Pending screenshot stored.', meta ? `(${meta.width}x${meta.height}, display ${meta.displayIndex})` : '');
  }

  /**
   * Clear the pending screenshot without using it
   */
  clearPendingScreenshot() {
    this.pendingScreenshot = null;
    this.pendingImageMeta = null;
  }

  /**
   * Store files (parsed by file-attachment.js) to attach to the next request.
   * @param {Array<object>} files
   */
  setPendingFiles(files) {
    this.pendingFiles = (Array.isArray(files) && files.length) ? files : null;
    console.log(`[ContextEngine] Pending files stored: ${this.pendingFiles ? this.pendingFiles.length : 0}`);
  }

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

    // Consume any pending attached files (used in both fresh & frozen paths).
    let attachedFiles = null;
    if (this.pendingFiles) {
      attachedFiles = this.pendingFiles;
      this.pendingFiles = null;
    }

    // If we are in Context Freeze Mode and have a frozen context, reuse it (update timestamp and question)
    if (isFrozen && this.frozenContext) {
      return {
        ...this.frozenContext,
        timestamp: new Date().toISOString(),
        question: question,
        // Newly attached files (if any) override; otherwise keep the frozen set.
        attached_files: attachedFiles || this.frozenContext.attached_files || null
      };
    }

    // Use pending screenshot if available, otherwise skip (text-only mode)
    let imageBase64;
    let imageMeta = null;
    if (this.pendingScreenshot) {
      imageBase64 = this.pendingScreenshot;
      imageMeta = this.pendingImageMeta;
      this.pendingScreenshot = null; // Consume it
      this.pendingImageMeta = null;
      console.log('[ContextEngine] Using pre-captured screenshot.');
    } else {
      imageBase64 = null; // No screenshot — text-only mode
      console.log('[ContextEngine] No screenshot — text-only mode.');
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
      image_meta: imageMeta,
      attached_files: attachedFiles
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
