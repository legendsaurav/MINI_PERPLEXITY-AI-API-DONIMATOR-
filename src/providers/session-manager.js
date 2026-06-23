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
  }

  /**
   * Checks if the user is currently authenticated with a provider
   * @param {string} provider 
   * @param {Electron.WebContents} webContents 
   * @returns {Promise<boolean>}
   */
  async checkAuthStatus(provider, webContents) {
    try {
      const url = webContents.getURL();
      const caps = capabilities.getCapabilities(provider);
      
      // CRITICAL FIX: First check if we're even on the correct domain.
      // If the browser was redirected to Google OAuth or another external page,
      // we are definitely NOT authenticated with the AI provider.
      if (provider === 'chatgpt' && !url.includes('chatgpt.com')) {
        console.log(`[SessionManager] Not on chatgpt.com (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'gemini' && !url.includes('gemini.google.com')) {
        console.log(`[SessionManager] Not on gemini.google.com (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'claude' && !url.includes('claude.ai')) {
        console.log(`[SessionManager] Not on claude.ai (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'kimi' && !url.includes('kimi.moonshot.cn')) {
        console.log(`[SessionManager] Not on kimi.moonshot.cn (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'deepseek' && !url.includes('deepseek.com')) {
        console.log(`[SessionManager] Not on deepseek.com (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'perplexity' && !url.includes('perplexity.ai')) {
        console.log(`[SessionManager] Not on perplexity.ai (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }
      if (provider === 'google' && !url.includes('google.com')) {
        console.log(`[SessionManager] Not on google.com (currently: ${new URL(url).hostname}). Not authenticated.`);
        this.setAuthState(provider, false);
        return false;
      }

      // Now we're on the correct domain — check for login buttons
      let isAuthenticated = true;
      if (provider === 'chatgpt') {
        // chatgpt redirects to login or shows login buttons if not auth'd
        const hasLoginButton = await webContents.executeJavaScript(`
          !!document.querySelector('[data-testid="login-button"]') || !!document.querySelector('a[href*="/auth/login"]')
        `);
        isAuthenticated = !hasLoginButton;
      } else if (provider === 'gemini') {
        const hasSignIn = await webContents.executeJavaScript(`
          !!document.querySelector('a[href*="ServiceLogin"]') || document.body.innerText.includes('Sign in')
        `);
        isAuthenticated = !hasSignIn;
      } else if (provider === 'claude') {
        // claude redirects to /login
        isAuthenticated = !url.includes('/login');
      } else if (provider === 'kimi') {
        // kimi redirects to homepage or login if not logged in
        isAuthenticated = !url.includes('/login') && !url.includes('/sign');
      } else if (provider === 'deepseek') {
        // deepseek redirects to /sign-in or shows sign-in button
        isAuthenticated = !url.includes('/sign-in') && !url.includes('/login');
      } else if (provider === 'perplexity') {
        // perplexity redirects to /login
        isAuthenticated = !url.includes('/login') && !url.includes('/signin');
      } else if (provider === 'google') {
        isAuthenticated = true;
      }

      this.setAuthState(provider, isAuthenticated);
      return isAuthenticated;
    } catch (error) {
      console.error(`Error checking auth status for ${provider}:`, error);
      return false;
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
