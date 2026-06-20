const { BrowserWindow } = require('electron');
const path = require('path');
const browserProfileManager = require('./browser-profile-manager');
const capabilities = require('./provider-capabilities');

// ============================================================
// 🔍 DEBUG MODE - Set to true to make the hidden browser VISIBLE
// so you can see what's happening (CloudFlare, CAPTCHA, login, etc.)
// ============================================================
const DEBUG_MODE = false;

/**
 * Hidden Browser Manager
 * Spawns and manages the hidden BrowserWindow for AI communication.
 */
class HiddenBrowserManager {
  constructor() {
    this.windows = new Map(); // provider -> BrowserWindow
  }

  /**
   * Ensure a hidden window exists for the provider and is loaded
   * @param {string} provider 
   * @returns {Promise<BrowserWindow>}
   */
  async ensureWindow(provider) {
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

    // Log navigation events for debugging
    win.webContents.on('did-navigate', (event, url) => {
      console.log(`[DEBUG] 🌐 Navigated to: ${url}`);
    });
    win.webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[DEBUG] 🌐 In-page navigation: ${url}`);
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[DEBUG] ❌ Failed to load: ${validatedURL} | Error: ${errorCode} ${errorDescription}`);
    });
    win.webContents.on('did-finish-load', () => {
      console.log(`[DEBUG] ✅ Page finished loading: ${win.webContents.getURL()}`);
    });

    console.log(`[DEBUG] 🚀 Loading URL: ${caps.baseUrl}`);
    await win.loadURL(caps.baseUrl);
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
