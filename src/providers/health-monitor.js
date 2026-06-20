const sessionManager = require('./session-manager');
const hiddenBrowserManager = require('./hidden-browser-manager');
const stateManager = require('../main/state-manager');
const eventBus = require('../main/event-bus');

/**
 * Health Monitor
 * Periodically verifies that the hidden browser is alive, authenticated, 
 * and functioning. Triggers recovery if a crash occurs.
 */
class HealthMonitor {
  constructor() {
    this.intervalId = null;
  }

  start() {
    if (this.intervalId) return;
    // Check every 10 seconds
    this.intervalId = setInterval(() => this.checkHealth(), 10000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkHealth() {
    const currentProvider = stateManager.get('currentProvider');
    if (!currentProvider) return;

    try {
      const win = hiddenBrowserManager.getWindow(currentProvider);
      
      // 1. Check if window process is alive
      if (!win || win.isDestroyed()) {
        console.warn(`Health Monitor: Hidden browser for ${currentProvider} is dead. Recovering...`);
        await this.recoverBrowser(currentProvider);
        return;
      }

      // 2. Check if page crashed (webContents is dead)
      if (win.webContents.isCrashed()) {
        console.warn(`Health Monitor: WebContents crashed for ${currentProvider}. Recovering...`);
        await this.recoverBrowser(currentProvider);
        return;
      }

      // 3. Verify Authentication State
      const isAuth = await sessionManager.checkAuthStatus(currentProvider, win.webContents);
      if (!isAuth) {
        // Just log, the Session Manager will have emitted 'sessionExpired'
        // which triggers the UI to prompt for login.
        return;
      }

      // If healthy, emit event (optional)
      // eventBus.emit('browserHealthy', currentProvider);

    } catch (error) {
      console.error('Error during health check:', error);
    }
  }

  async recoverBrowser(provider) {
    eventBus.emit('browserRecoveryStarted', provider);
    
    // Attempt to respawn the window
    await hiddenBrowserManager.ensureWindow(provider);
    
    eventBus.emit('browserRecovered', provider);
  }
}

module.exports = new HealthMonitor();
