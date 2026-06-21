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
      const intervalId = setInterval(async () => {
        if (win.isDestroyed()) {
          clearInterval(intervalId);
          return;
        }
        try {
          const info = await win.webContents.executeJavaScript(`
            (function() {
              try {
                const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                  text: b.innerText ? b.innerText.substring(0, 30) : '',
                  className: b.className,
                  type: b.getAttribute('type'),
                  id: b.id,
                  disabled: b.disabled
                }));
                const textareas = Array.from(document.querySelectorAll('textarea, div[contenteditable="true"]')).map(t => ({
                  tagName: t.tagName,
                  className: t.className,
                  placeholder: t.placeholder || t.getAttribute('placeholder'),
                  value: (t.value || t.innerText || '').substring(0, 50)
                }));
                const editor = document.querySelector('.chat-input-editor');
                const grandparentHtml = editor && editor.parentElement && editor.parentElement.parentElement ? editor.parentElement.parentElement.outerHTML.substring(0, 1500) : 'not found';
                
                // Find all elements whose class includes message, chat, or content
                const classMatches = [];
                document.querySelectorAll('*').forEach(el => {
                  const cls = el.className;
                  if (cls && typeof cls === 'string' && (cls.includes('message') || cls.includes('chat') || cls.includes('content') || cls.includes('btn') || cls.includes('send'))) {
                    classMatches.push({
                      tag: el.tagName,
                      class: cls,
                      text: el.innerText ? el.innerText.substring(0, 30).replace(/\\n/g, ' ') : ''
                    });
                  }
                });

                // Find elements containing "hi" or other text to locate message bubbles
                const textMatches = [];
                document.querySelectorAll('*').forEach(el => {
                  if (el.children.length === 0 && el.innerText && el.innerText.trim().length > 0) {
                    const text = el.innerText.trim();
                    if (text === 'hi' || text.toLowerCase().includes('hello') || text.includes('Kimi')) {
                      textMatches.push({
                        tag: el.tagName,
                        class: el.className,
                        text: text.substring(0, 40),
                        parentTag: el.parentElement ? el.parentElement.tagName : '',
                        parentClass: el.parentElement ? el.parentElement.className : ''
                      });
                    }
                  }
                });

                const bodyText = document.body ? document.body.innerText.substring(0, 200) : '';
                return { 
                  url: window.location.href, 
                  buttons, 
                  textareas, 
                  grandparentHtml, 
                  bodyTextLength: bodyText.length,
                  classMatches: classMatches.slice(0, 30), // limit size
                  textMatches: textMatches.slice(0, 30)
                };
              } catch (err) {
                return { error: err.message };
              }
            })()
          `);
          console.log('[DOM INFO] ' + JSON.stringify(info));
        } catch (e) {
          // ignore
        }
      }, 5000);
      setTimeout(() => clearInterval(intervalId), 30000);
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[DEBUG] ❌ Failed to load: ${validatedURL} | Error: ${errorCode} ${errorDescription}`);
    });
    win.webContents.on('did-finish-load', () => {
      console.log(`[DEBUG] ✅ Page finished loading: ${win.webContents.getURL()}`);
    });
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[BROWSER CONSOLE] ${message}`);
    });

    console.log(`[DEBUG] 🚀 Loading URL: ${caps.baseUrl}`);
    win.loadURL(caps.baseUrl).catch(err => {
      console.warn(`[HiddenBrowser] loadURL promise warning:`, err.message);
    });
    
    await new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      win.webContents.once('did-finish-load', done);
      win.webContents.once('dom-ready', done);
      setTimeout(done, 15000); // 15s fallback timeout
    });
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
