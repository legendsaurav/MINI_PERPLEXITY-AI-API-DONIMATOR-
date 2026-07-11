const { BrowserWindow } = require('electron');
const path = require('path');
const browserProfileManager = require('./browser-profile-manager');
const capabilities = require('./provider-capabilities');

// ============================================================
// 🔍 DEBUG MODE - Set to true to make the hidden browser VISIBLE
// so you can see what's happening (CloudFlare, CAPTCHA, login, etc.)
// Set to false to keep the AI browser hidden during normal operation.
// (Login is still possible via showForLogin() when a provider needs it.)
// ============================================================
const DEBUG_MODE = false;

/**
 * Hidden Browser Manager
 * Spawns and manages the hidden BrowserWindow for AI communication.
 */
class HiddenBrowserManager {
  constructor() {
    this.windows = new Map(); // provider -> BrowserWindow
    this.lastUrls = new Map(); // provider -> string (last visited URL)
  }

  /**
   * Destroy all backend browser windows except the specified one
   * to ensure only one runs at a time.
   * @param {string} exceptProvider 
   */
  destroyOtherWindows(exceptProvider) {
    const toDestroy = [];
    for (const [provider, win] of this.windows.entries()) {
      if (provider !== exceptProvider) {
        toDestroy.push({ provider, win });
      }
    }

    for (const { provider, win } of toDestroy) {
      if (win && !win.isDestroyed()) {
        try {
          const currentUrl = win.webContents.getURL();
          if (currentUrl && currentUrl.startsWith('http')) {
            console.log(`[HiddenBrowser] Saving last URL for ${provider}: ${currentUrl}`);
            this.lastUrls.set(provider, currentUrl);
          }
        } catch (e) {
          console.error(`[HiddenBrowser] Failed to get URL before destroying:`, e.message);
        }
        console.log(`[HiddenBrowser] Closing existing backend browser window for: ${provider}`);
        win.destroy();
      }
      this.windows.delete(provider);
    }
  }

  /**
   * Ensure a hidden window exists for the provider and is loaded
   * @param {string} provider 
   * @returns {Promise<BrowserWindow>}
   */
  async ensureWindow(provider) {
    this.destroyOtherWindows(provider);

    if (this.windows.has(provider) && !this.windows.get(provider).isDestroyed()) {
      return this.windows.get(provider);
    }

    const partition = browserProfileManager.getPartition(provider);
    const caps = capabilities.getCapabilities(provider);

    const showWindow = DEBUG_MODE;

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: showWindow, // DEBUG: visible when DEBUG_MODE is true
      title: `[DEBUG] AI Browser - ${provider}`,
      webPreferences: {
        partition: partition,
        preload: path.join(__dirname, '../main/ai-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // Optional: reduce background throttling so observer fires instantly
        backgroundThrottling: false
      }
    });

    // In debug mode, open DevTools so you can see network requests, console, etc.
    if (DEBUG_MODE) {
      win.webContents.openDevTools({ mode: 'bottom' });
      console.log(`[DEBUG] 🔍 Browser window for "${provider}" is now VISIBLE with DevTools open.`);
      console.log(`[DEBUG] 🔍 Watch the browser window to see what's happening!`);
    }

    this.windows.set(provider, win);
    
    win.on('closed', () => {
      this.windows.delete(provider);
    });

    // Log navigation events for debugging and save last visited URL
    win.webContents.on('did-navigate', (event, url) => {
      console.log(`[DEBUG] 🌐 Navigated to: ${url}`);
      if (url && url.startsWith('http')) {
        this.lastUrls.set(provider, url);
      }
    });
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Browser Console - ${provider}] ${message}`);
    });
    win.webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[DEBUG] 🌐 In-page navigation: ${url}`);
      if (url && url.startsWith('http')) {
        this.lastUrls.set(provider, url);
        // Real-time conversation URL tracking: ChatGPT uses client-side routing,
        // so it navigates in-page from chatgpt.com → chatgpt.com/c/<id> after
        // the first message. Capture this immediately so it's available when
        // streamFinished fires.
        try {
          const stateManager = require('../main/state-manager');
          if (stateManager.isConversationUrl(provider, url)) {
            const existingUrl = stateManager.getConstantUrl(provider);
            if (existingUrl !== url) {
              stateManager.setConstantUrl(provider, url);
              console.log(`[HiddenBrowser] Conversation URL auto-captured for ${provider}: ${url}`);
            }
          }
        } catch (e) {
          // Non-critical
        }
      }
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[DEBUG] ❌ Failed to load: ${validatedURL} | Error: ${errorCode} ${errorDescription}`);
    });
    win.webContents.on('did-finish-load', () => {
      const currentUrl = win.webContents.getURL();
      console.log(`[DEBUG] ✅ Page finished loading: ${currentUrl}`);
      if (currentUrl && currentUrl.startsWith('http')) {
        this.lastUrls.set(provider, currentUrl);
      }
      // Re-attach MutationObserver on full page load (crucial for multi-page search flows like Google)
      try {
        const browserController = require('./browser-controller');
        browserController.attachStreamObserver(provider).catch(err => {
          console.log(`[HiddenBrowser] Failed to auto-attach observer for ${provider}: ${err.message}`);
        });
      } catch (err) {
        console.error(`[HiddenBrowser] Error re-attaching observer for ${provider}:`, err.message);
      }
    });

    const targetUrl = this.lastUrls.get(provider) || caps.baseUrl;
    console.log(`[DEBUG] 🚀 Loading URL: ${targetUrl}`);
    await win.loadURL(targetUrl);
    return win;
  }

  /**
   * Show window temporarily for login purposes
   * @param {string} provider 
   */
  showForLogin(provider) {
    const win = this.windows.get(provider);
    if (win && !win.isDestroyed()) {
      win.show();
    }
  }

  /**
   * Hide window after login
   * @param {string} provider 
   */
  hideAfterLogin(provider) {
    const win = this.windows.get(provider);
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }

  getWindow(provider) {
    if (this.windows.has(provider) && !this.windows.get(provider).isDestroyed()) {
      return this.windows.get(provider);
    }
    return null;
  }

  reloadWindow(provider) {
    const win = this.getWindow(provider);
    if (win) {
      console.log(`[HiddenBrowser] Reloading window for ${provider}...`);
      win.webContents.reload();
      return true;
    }
    return false;
  }
}

module.exports = new HiddenBrowserManager();
