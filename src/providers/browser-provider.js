const { ipcMain } = require('electron');
const AIProvider = require('./provider-interface');
const hiddenBrowserManager = require('./hidden-browser-manager');
const sessionManager = require('./session-manager');
const conversationLocator = require('./conversation-locator');
const browserController = require('./browser-controller');
const healthMonitor = require('./health-monitor');
const eventBus = require('../main/event-bus');

/**
 * BrowserProvider
 * Concrete implementation of AIProvider that orchestrates the hidden browser.
 */
class BrowserProvider extends AIProvider {
  constructor(providerName) {
    super();
    this.providerName = providerName;
    this.setupIPC();
  }

  setupIPC() {
    // Guard: only register IPC listeners once across all BrowserProvider instances
    if (BrowserProvider._ipcRegistered) return;
    BrowserProvider._ipcRegistered = true;

    // Listen to messages from ai-preload.js
    // Emit as "raw" events so StreamManager can buffer/process before overlay receives them
    ipcMain.on('ai-chunk', (event, chunk) => {
      console.log(`[BrowserProvider] ai-chunk received (${typeof chunk === 'string' ? chunk.length : '?'} chars)`);
      eventBus.emit('rawStreamChunk', chunk);
    });

    ipcMain.on('ai-sync', (event, fullText) => {
      console.log(`[BrowserProvider] ai-sync received (${typeof fullText === 'string' ? fullText.length : '?'} chars)`);
      eventBus.emit('rawStreamSync', fullText);
    });

    ipcMain.on('ai-complete', (event, data) => {
      console.log(`[BrowserProvider] ai-complete received:`, JSON.stringify(data).substring(0, 200));
      eventBus.emit('rawStreamFinished', data);
    });

    ipcMain.on('ai-error', (event, err) => {
      console.log(`[BrowserProvider] ai-error received:`, err);
      eventBus.emit('rawStreamError', err);
    });
  }

  async initialize() {
    const win = await hiddenBrowserManager.ensureWindow(this.providerName);
    
    // Check if logged in
    const isAuth = await sessionManager.checkAuthStatus(this.providerName, win.webContents);
    if (!isAuth) {
      eventBus.emit('sessionExpired', this.providerName);
    }

    healthMonitor.start();
  }

  async createProject(projectName) {
    return projectName;
  }

  async selectProject(projectData) {
    const { conversation_title } = projectData;
    if (conversation_title) {
      await conversationLocator.restoreConversation(this.providerName, conversation_title);
    }
  }

  async sendPrompt(contextObject) {
    const promptString = contextObject.question;
    const imageBase64 = contextObject.image_base64 || null;
    
    const win = hiddenBrowserManager.getWindow(this.providerName);
    if (win) {
      const stateManager = require('../main/state-manager');
      const constantUrl = stateManager.getConstantUrl(this.providerName);
      if (constantUrl) {
        const currentUrl = win.webContents.getURL();
        if (currentUrl !== constantUrl) {
          console.log(`[BrowserProvider] Navigating to constant conversation URL: ${constantUrl}`);
          try {
            await win.loadURL(constantUrl);
            await new Promise(resolve => {
              win.webContents.once('did-finish-load', resolve);
              win.webContents.once('did-fail-load', resolve);
              setTimeout(resolve, 6000);
            });
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (err) {
            console.error(`[BrowserProvider] Navigation to constant URL failed: ${err.message}`);
          }
        }
      }

      // Check if prompt input elements are present on the loaded page.
      // If not, it means the navigation failed, timed out, or the page is showing an error.
      const selectors = require('./selector-manager').getSelectors(this.providerName);
      let hasInput = await win.webContents.executeJavaScript(`
        !!(document.querySelector('${selectors.textarea}') || 
           document.querySelector('#prompt-textarea') || 
           document.querySelector('[contenteditable="true"]'))
      `).catch(() => false);

      if (!hasInput) {
        console.warn(`[BrowserProvider] No valid prompt input element found on the current page. Recovering to provider base URL...`);
        stateManager.setConstantUrl(this.providerName, null);
        const caps = require('./provider-capabilities').getCapabilities(this.providerName);
        console.log(`[BrowserProvider] Loading base URL: ${caps.baseUrl}`);
        await win.loadURL(caps.baseUrl).catch(err => console.error(`[BrowserProvider] Failed to load base URL: ${err.message}`));
        await new Promise(resolve => {
          win.webContents.once('did-finish-load', resolve);
          win.webContents.once('did-fail-load', resolve);
          setTimeout(resolve, 8000);
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Attach observer BEFORE submitting so we don't miss chunks
    await browserController.attachStreamObserver(this.providerName);
    
    // If we have an image, inject it first, then text + submit
    if (imageBase64) {
      await browserController.injectImageAndSubmit(this.providerName, promptString, imageBase64);
    } else {
      await browserController.injectAndSubmit(this.providerName, promptString);
    }
  }

  cancel() {
    // TODO: implement clicking the 'stop generating' button via browserController
  }

  shutdown() {
    healthMonitor.stop();
  }
}

module.exports = BrowserProvider;
