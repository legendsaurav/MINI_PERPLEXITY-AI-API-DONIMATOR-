const eventBus = require('../main/event-bus');
const browserProfileManager = require('./browser-profile-manager');
const capabilities = require('./provider-capabilities');

/**
 * Session Manager
 * Owns authentication state. Detects login/logout state, handles session
 * expiration, and notifies Health Monitor of state changes.
 */
class SessionManager {
  constructor() {
    this.authStates = new Map(); // provider -> boolean
    this.checkingProviders = new Set(); // providers currently checking auth
  }

  /**
   * Checks if the user is currently authenticated with a provider
   * @param {string} provider 
   * @param {Electron.WebContents} webContents 
   * @returns {Promise<boolean>}
   */
  async safeExecuteJavaScript(webContents, code, timeoutMs = 4000) {
    try {
      return await Promise.race([
        webContents.executeJavaScript(code),
        new Promise((_, reject) => setTimeout(() => reject(new Error('executeJavaScript timeout')), timeoutMs))
      ]);
    } catch (err) {
      console.warn(`[SessionManager] safeExecuteJavaScript warning: ${err.message}`);
      return null;
    }
  }

  /**
   * Checks if the user is currently authenticated with a provider
   * @param {string} provider 
   * @param {Electron.WebContents} webContents 
   * @returns {Promise<boolean>}
   */
  async checkAuthStatus(provider, webContents) {
    if (this.checkingProviders.has(provider)) {
      console.log(`[SessionManager] checkAuthStatus already in progress for ${provider}, skipping concurrent check.`);
      return this.isAuthenticated(provider);
    }
    
    this.checkingProviders.add(provider);
    try {
      const url = webContents.getURL();
      if (!url || url === 'about:blank') {
        console.log(`[SessionManager] URL is empty or blank, skipping auth check.`);
        return false;
      }
      const caps = capabilities.getCapabilities(provider);
      
      if (caps) {
        const allowedDomains = caps.domains || [];
        const isCorrectDomain = allowedDomains.some(d => url.includes(d));
        if (provider !== 'googlesearch' && !isCorrectDomain) {
          let hostname = '';
          try {
            hostname = new URL(url).hostname;
          } catch (e) {
            hostname = url;
          }
          console.log(`[SessionManager] Not on allowed domains for ${provider} (currently: ${hostname}). Not authenticated.`);
          this.setAuthState(provider, false);
          return false;
        }
      }

      // Check for login indicators in URL first
      let isAuthenticated = true;
      const urlLower = url.toLowerCase();
      if (provider !== 'googlesearch' && (
        urlLower.includes('/login') || 
        urlLower.includes('/auth/login') || 
        urlLower.includes('/signin') || 
        urlLower.includes('/servicelogin')
      )) {
        isAuthenticated = false;
      } else if (provider === 'chatgpt') {
        const hasLoginButton = await this.safeExecuteJavaScript(webContents, `
          !!document.querySelector('[data-testid="login-button"]') || !!document.querySelector('a[href*="/auth/login"]')
        `);
        isAuthenticated = hasLoginButton === null ? true : !hasLoginButton;
      } else if (provider === 'gemini') {
        const hasSignIn = await this.safeExecuteJavaScript(webContents, `
          !!document.querySelector('a[href*="ServiceLogin"]') || (document.body && document.body.innerText.includes('Sign in'))
        `);
        isAuthenticated = hasSignIn === null ? true : !hasSignIn;
      } else if (provider === 'claude') {
        isAuthenticated = !url.includes('/login');
      } else if (provider === 'kimi' || provider === 'deepseek') {
        const hasLoginButton = await this.safeExecuteJavaScript(webContents, `
          (function() {
            try {
              if (document.querySelector('button.login-btn') || document.querySelector('a[href*="/login"]')) {
                return true;
              }
              const text = document.body ? document.body.innerText : '';
              if (text.includes('Log in') || text.includes('Sign in') || text.includes('登录') || text.includes('微信登录')) {
                return true;
              }
              return false;
            } catch(e) {
              return false;
            }
          })()
        `);
        isAuthenticated = hasLoginButton === null ? true : !hasLoginButton;
      } else if (provider === 'googlesearch') {
        isAuthenticated = true;
      }

      this.setAuthState(provider, isAuthenticated);
      return isAuthenticated;
    } catch (error) {
      console.error(`Error checking auth status for ${provider}:`, error);
      return false;
    } finally {
      this.checkingProviders.delete(provider);
    }
  }

  /**
   * Update internal state and emit event if changed
   */
  setAuthState(provider, isAuthenticated) {
    const currentState = this.authStates.get(provider);
    if (currentState !== isAuthenticated) {
      this.authStates.set(provider, isAuthenticated);
      if (!isAuthenticated) {
        eventBus.emit('sessionExpired', provider);
      } else {
        eventBus.emit('sessionAuthenticated', provider);
      }
    }
  }

  isAuthenticated(provider) {
    return this.authStates.get(provider) || false;
  }

  async logout(provider) {
    await browserProfileManager.clearProfile(provider);
    this.setAuthState(provider, false);
  }
}

module.exports = new SessionManager();
