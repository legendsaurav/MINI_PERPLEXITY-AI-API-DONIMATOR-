const { session } = require('electron');

/**
 * Browser Profile Manager
 * Manages separate isolated partitions (cookies, localstorage) for each provider.
 * This prevents cookie conflicts and allows simultaneous logins.
 */
class BrowserProfileManager {
  /**
   * Get the partition string for a provider
   * @param {string} providerName 
   * @returns {string} e.g. "persist:chatgpt"
   */
  getPartition(providerName) {
    return `persist:${providerName}`;
  }

  /**
   * Get the actual Electron session object for a provider
   * @param {string} providerName 
   * @returns {Electron.Session}
   */
  getSession(providerName) {
    return session.fromPartition(this.getPartition(providerName));
  }

  /**
   * Clear all data for a specific provider
   * @param {string} providerName 
   */
  async clearProfile(providerName) {
    const ses = this.getSession(providerName);
    await ses.clearStorageData();
  }
}

module.exports = new BrowserProfileManager();
