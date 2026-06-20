const { ipcMain } = require('electron');
const eventBus = require('./event-bus');
const projectManager = require('./project-manager');
const stateManager = require('./state-manager');

/**
 * IPC Manager
 * Centralizes all Electron IPC communication to prevent tight coupling.
 * Translates renderer IPC messages to Event Bus events and vice versa.
 */
class IPCManager {
  constructor() {
    this.overlayWebContents = null;
    this.inputWebContents = null;
    this.settingsWebContents = null;
    this.projectsWebContents = null;
    this.initialized = false;
  }

  /**
   * Register WebContents targets for dispatching events to renderers
   * @param {BrowserWindow} overlay
   * @param {BrowserWindow} input
   * @param {BrowserWindow} settings
   * @param {BrowserWindow} projects
   */
  registerWindows(overlay, input, settings, projects) {
    if (overlay) this.overlayWebContents = overlay.webContents;
    if (input) this.inputWebContents = input.webContents;
    if (settings) this.settingsWebContents = settings.webContents;
    if (projects) this.projectsWebContents = projects.webContents;
  }

  /**
   * Safely register an ipcMain.handle channel.
   * Removes any existing handler first to prevent "Attempted to register
   * a second handler" crashes.
   */
  safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (_) { /* no-op */ }
    ipcMain.handle(channel, handler);
  }

  /**
   * Setup all IPC listeners
   */
  initialize() {
    if (this.initialized) {
      console.log('[IPC Manager] Already initialized, skipping.');
      return;
    }
    this.initialized = true;
    console.log('[IPC Manager] Registering IPC handlers...');

    // ── Input Popup -> Main ──────────────────────────────────────────
    ipcMain.on('submit-question', (event, text) => {
      eventBus.emit('userQuestionSubmitted', text);
    });

    ipcMain.on('cancel-request', () => {
      const currentRequest = stateManager.get('currentRequest');
      if (currentRequest) {
        // Cancel active request
        eventBus.emit('userRequestCancelled');
      } else if (stateManager.get('contextFreeze')) {
        // End frozen context session (replaces removed global Escape handler)
        const contextEngine = require('./context-engine');
        contextEngine.clearFrozenContext();
        eventBus.emit('sessionEnded');
      } else {
        // No request and no freeze — just emit cancel for any listeners
        eventBus.emit('userRequestCancelled');
      }
    });

    // ── Global App Events -> UI ───────────────────────────────────────
    eventBus.on('providerSwitched', (provider) => {
      this.sendToOverlay('provider-switched', provider);
      this.sendToInput('provider-switched', provider);
    });

    // ── Window Controls -> Main ──────────────────────────────────────
    ipcMain.on('toggle-overlay', () => {
      eventBus.emit('toggleOverlayRequested');
    });

    ipcMain.on('toggle-projects', () => {
      eventBus.emit('toggleProjectsRequested');
    });

    // ── Main -> Overlay (via Event Bus subscriptions) ────────────────
    eventBus.on('streamStart', (data) => this.sendToOverlay('stream-start', data));
    eventBus.on('streamChunk', (data) => this.sendToOverlay('stream-chunk', data));
    eventBus.on('streamFinished', (data) => this.sendToOverlay('stream-end', data));
    eventBus.on('streamError', (err) => this.sendToOverlay('stream-error', err));

    // ── Project updates to UI ────────────────────────────────────────
    eventBus.on('projectChanged', (projectData) => {
      this.sendToOverlay('project-updated', projectData);
      this.sendToInput('project-updated', projectData);
      this.sendToProjects('projects-updated', projectData);
    });

    eventBus.on('contextAutoSwitched', (contextData) => {
      this.sendToProjects('context-changed', contextData);
    });

    // ── Settings & Auth Handlers (Invokes) ───────────────────────────
    this.safeHandle('get-settings', () => {
      return { provider: stateManager.get('currentProvider') };
    });

    this.safeHandle('save-settings', (event, settings) => {
      if (settings.provider) {
        stateManager.set('currentProvider', settings.provider);
      }
      return true;
    });

    this.safeHandle('get-auth-status', async (event, provider) => {
      const sessionManager = require('../providers/session-manager');
      return sessionManager.isAuthenticated(provider);
    });

    this.safeHandle('login-provider', (event, provider) => {
      const hiddenBrowserManager = require('../providers/hidden-browser-manager');
      // Show the hidden window so user can login manually
      hiddenBrowserManager.showForLogin(provider);
      return true;
    });

    // ── Project CRUD Handlers ────────────────────────────────────────
    this.safeHandle('get-projects', async () => {
      return projectManager.listProjectsWithDetails();
    });

    this.safeHandle('create-project', async (event, name) => {
      const project = await projectManager.saveProject(name);
      eventBus.emit('projectChanged', project);
      return project;
    });

    this.safeHandle('switch-project', async (event, name) => {
      return projectManager.switchProject(name);
    });

    this.safeHandle('get-active-project', async () => {
      const name = stateManager.get('currentProject');
      const project = name ? await projectManager.getProject(name) : null;
      return { name, project };
    });

    this.safeHandle('delete-project', async (event, name) => {
      return projectManager.deleteProject(name);
    });

    this.safeHandle('rename-project', async (event, oldName, newName) => {
      return projectManager.renameProject(oldName, newName);
    });

    // ── Conversation Management Handlers ─────────────────────────────
    this.safeHandle('get-conversation-history', async () => {
      return projectManager.listProjectsWithDetails();
    });

    this.safeHandle('open-conversation', async (event, projectName) => {
      eventBus.emit('openConversationRequested', projectName);
      return true;
    });

    this.safeHandle('unlink-conversation', async (event, projectName) => {
      return projectManager.unlinkConversation(projectName);
    });

    this.safeHandle('reassign-conversation', async (event, projectName, data) => {
      const { url, title } = data || {};
      return projectManager.updateConversationRef(projectName, url, title);
    });

    // ── Conversation List / Picker Handlers ──────────────────────────────
    this.safeHandle('get-conversation-list', async () => {
      const browserController = require('../providers/browser-controller');
      const provider = stateManager.get('currentProvider') || 'chatgpt';
      return browserController.getConversationList(provider);
    });

    this.safeHandle('select-conversation', async (event, url, title) => {
      const browserController = require('../providers/browser-controller');
      const provider = stateManager.get('currentProvider') || 'chatgpt';
      await browserController.navigateToConversation(provider, url);
      // Update active project's conversation reference
      const activeProject = stateManager.get('currentProject');
      if (activeProject && url) {
        await projectManager.updateConversationRef(activeProject, url, title || '');
        eventBus.emit('projectChanged', { project_name: activeProject });
      }
      return true;
    });

    ipcMain.on('toggle-conversation-picker', () => {
      eventBus.emit('toggleConversationPickerRequested');
    });

    console.log('[IPC Manager] All handlers registered successfully.');
  }

  /**
   * Safely dispatch to Overlay Renderer
   */
  sendToOverlay(channel, payload) {
    if (this.overlayWebContents && !this.overlayWebContents.isDestroyed()) {
      this.overlayWebContents.send(channel, payload);
    }
  }

  /**
   * Safely dispatch to Input Popup Renderer
   */
  sendToInput(channel, payload) {
    if (this.inputWebContents && !this.inputWebContents.isDestroyed()) {
      this.inputWebContents.send(channel, payload);
    }
  }

  /**
   * Safely dispatch to Projects Panel Renderer
   */
  sendToProjects(channel, payload) {
    if (this.projectsWebContents && !this.projectsWebContents.isDestroyed()) {
      this.projectsWebContents.send(channel, payload);
    }
  }
}

module.exports = new IPCManager();
