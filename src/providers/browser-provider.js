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
