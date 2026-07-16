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

// Browser lanes. The overlay (mini-perplexity hotkey flow) and the HTTP API
// (:9876 /v1/chat/completions) each get their OWN pool of hidden windows so
// they never share a page, a conversation, or a stream. Keys in this.windows
// are "<lane>:<provider>".
const LANES = ['overlay', 'api'];

/**
 * Hidden Browser Manager
 * Spawns and manages the hidden BrowserWindows for AI communication,
 * partitioned into isolated lanes (overlay vs api).
 */
class HiddenBrowserManager {
  constructor() {
    this.windows = new Map(); // "<lane>:<provider>" -> BrowserWindow
    this.lastUrls = new Map(); // "<lane>:<provider>" -> string (last visited URL)
  }

  _key(provider, lane) {
    return `${lane}:${provider}`;
  }

  /**
   * Destroy other windows IN THE SAME LANE only, so the api lane can never
   * tear down the overlay's browser (and vice versa).
   * @param {string} exceptProvider
   * @param {string} lane
   */
  destroyOtherWindows(exceptProvider, lane = 'overlay') {
    const toDestroy = [];
    for (const [key, win] of this.windows.entries()) {
      const [winLane, provider] = key.split(/:(.+)/, 2).length >= 2 ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [null, null];
      if (winLane === lane && provider !== exceptProvider) {
        toDestroy.push({ key, provider, win });
      }
    }

    for (const { key, provider, win } of toDestroy) {
      if (win && !win.isDestroyed()) {
        try {
          const currentUrl = win.webContents.getURL();
          if (currentUrl && currentUrl.startsWith('http')) {
            console.log(`[HiddenBrowser] Saving last URL for ${key}: ${currentUrl}`);
            this.lastUrls.set(key, currentUrl);
          }
        } catch (e) {
          console.error(`[HiddenBrowser] Failed to get URL before destroying:`, e.message);
        }
        console.log(`[HiddenBrowser] Closing backend browser window: ${key}`);
        win.destroy();
      }
      this.windows.delete(key);
    }
  }

  /**
   * Ensure a hidden window exists for the provider in the given lane.
   * @param {string} provider
   * @param {string} lane 'overlay' (default) | 'api'
   * @returns {Promise<BrowserWindow>}
   */
  async ensureWindow(provider, lane = 'overlay') {
    const key = this._key(provider, lane);
    this.destroyOtherWindows(provider, lane);

    if (this.windows.has(key) && !this.windows.get(key).isDestroyed()) {
      return this.windows.get(key);
    }

    // Same partition across lanes: shared cookies/logins (like two tabs of one
    // Chrome profile), but separate pages/conversations.
    const partition = browserProfileManager.getPartition(provider);
    const caps = capabilities.getCapabilities(provider);

    const showWindow = DEBUG_MODE;

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: showWindow, // DEBUG: visible when DEBUG_MODE is true
      title: `[DEBUG] AI Browser - ${lane}:${provider}`,
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
      console.log(`[DEBUG] 🔍 Browser window for "${key}" is now VISIBLE with DevTools open.`);
    }

    this.windows.set(key, win);

    win.on('closed', () => {
      this.windows.delete(key);
    });

    // Log navigation events for debugging and save last visited URL
    win.webContents.on('did-navigate', (event, url) => {
      console.log(`[DEBUG] 🌐 [${key}] Navigated to: ${url}`);
      if (url && url.startsWith('http')) {
        this.lastUrls.set(key, url);
      }
    });
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Browser Console - ${key}] ${message}`);
    });
    win.webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[DEBUG] 🌐 [${key}] In-page navigation: ${url}`);
      if (url && url.startsWith('http')) {
        this.lastUrls.set(key, url);
        // Real-time conversation URL tracking — OVERLAY LANE ONLY. The api lane
        // must never write shared conversation state, or a web request would
        // drag the user's overlay into its thread (the "clubbing" bug).
        if (lane === 'overlay') {
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
      }
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[DEBUG] ❌ [${key}] Failed to load: ${validatedURL} | Error: ${errorCode} ${errorDescription}`);
    });
    win.webContents.on('did-finish-load', () => {
      const currentUrl = win.webContents.getURL();
      console.log(`[DEBUG] ✅ [${key}] Page finished loading: ${currentUrl}`);
      if (currentUrl && currentUrl.startsWith('http')) {
        this.lastUrls.set(key, currentUrl);
      }
      // Re-attach MutationObserver on full page load (crucial for multi-page search flows like Google)
      try {
        const browserController = require('./browser-controller');
        browserController.attachStreamObserver(provider, lane).catch(err => {
          console.log(`[HiddenBrowser] Failed to auto-attach observer for ${key}: ${err.message}`);
        });
      } catch (err) {
        console.error(`[HiddenBrowser] Error re-attaching observer for ${key}:`, err.message);
      }
    });

    const targetUrl = this.lastUrls.get(key) || caps.baseUrl;
    console.log(`[DEBUG] 🚀 [${key}] Loading URL: ${targetUrl}`);
    await win.loadURL(targetUrl);
    return win;
  }

  /**
   * Show window temporarily for login purposes
   * @param {string} provider
   * @param {string} lane
   */
  showForLogin(provider, lane = 'overlay') {
    const win = this.windows.get(this._key(provider, lane));
    if (win && !win.isDestroyed()) {
      win.show();
    }
  }

  /**
   * Hide window after login
   * @param {string} provider
   * @param {string} lane
   */
  hideAfterLogin(provider, lane = 'overlay') {
    const win = this.windows.get(this._key(provider, lane));
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }

  getWindow(provider, lane = 'overlay') {
    const key = this._key(provider, lane);
    if (this.windows.has(key) && !this.windows.get(key).isDestroyed()) {
      return this.windows.get(key);
    }
    return null;
  }

  /** All live windows across every lane (used e.g. for display/exclusion lists). */
  getAllWindows() {
    const out = [];
    for (const win of this.windows.values()) {
      if (win && !win.isDestroyed()) out.push(win);
    }
    return out;
  }

  /**
   * True when the given webContents belongs to a window in `lane`.
   * Used to route ai-* IPC events so the overlay never receives api-lane
   * chunks and vice versa.
   */
  isLaneSender(lane, webContents) {
    if (!webContents) return false;
    for (const [key, win] of this.windows.entries()) {
      if (!key.startsWith(`${lane}:`)) continue;
      if (win && !win.isDestroyed() && win.webContents === webContents) return true;
    }
    return false;
  }

  /** True when webContents is exactly lane:provider's window. */
  isSenderOf(provider, lane, webContents) {
    const win = this.getWindow(provider, lane);
    return !!(win && webContents && win.webContents === webContents);
  }

  reloadWindow(provider, lane = 'overlay') {
    const win = this.getWindow(provider, lane);
    if (win) {
      console.log(`[HiddenBrowser] Reloading window for ${lane}:${provider}...`);
      win.webContents.reload();
      return true;
    }
    return false;
  }
}

module.exports = new HiddenBrowserManager();
