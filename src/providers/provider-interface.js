/**
 * Provider Interface
 * Abstract base class that all AI communication providers must implement.
 */
class AIProvider {
  /**
   * Initialize the provider (e.g. create hidden windows, load page)
   */
  async initialize() {
    throw new Error('Not implemented');
  }

  /**
   * Create a new conversation for a project
   * @param {string} projectName 
   * @returns {Promise<string>} conversation identifier/reference
   */
  async createProject(projectName) {
    throw new Error('Not implemented');
  }

  /**
   * Switch to an existing project's conversation
   * @param {object} projectData 
   */
  async selectProject(projectData) {
    throw new Error('Not implemented');
  }

  /**
   * Send a prompt with optional image, streaming response via events
   * @param {object} contextObject The structured context from Context Engine
   */
  async sendPrompt(contextObject) {
    throw new Error('Not implemented');
  }

  /**
   * Cancel the current in-flight request
   */
  cancel() {
    throw new Error('Not implemented');
  }

  /**
   * Reset conversation state if applicable
   */
  reset() {
    throw new Error('Not implemented');
  }

  /**
   * Clean up resources
   */
  shutdown() {
    throw new Error('Not implemented');
  }
}

module.exports = AIProvider;
