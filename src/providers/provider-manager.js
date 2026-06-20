const BrowserProvider = require('./browser-provider');
const stateManager = require('../main/state-manager');

/**
 * Provider Manager
 * Factory to retrieve the active provider implementation.
 */
class ProviderManager {
  constructor() {
    this.instances = new Map();
  }

  /**
   * Get or create a provider instance
   * @param {string} providerName 
   * @returns {BrowserProvider}
   */
  getProvider(providerName) {
    if (!this.instances.has(providerName)) {
      this.instances.set(providerName, new BrowserProvider(providerName));
    }
    return this.instances.get(providerName);
  }

  /**
   * Get the currently active provider based on StateManager
   */
  getActiveProvider() {
    const providerName = stateManager.get('currentProvider');
    if (!providerName) throw new Error('No provider selected');
    return this.getProvider(providerName);
  }
}

module.exports = new ProviderManager();
