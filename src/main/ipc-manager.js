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

    ipcMain.on('stop-agent', () => {
      eventBus.emit('stopAgentRequested');
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

    ipcMain.on('notify-voice-state', (event, state) => {
      eventBus.emit('voiceStateChanged', state);
    });

    ipcMain.on('trigger-pointer', (event, data) => {
      eventBus.emit('triggerPointerRequested', data);
    });

    ipcMain.on('toggle-cursor', (event, hide) => {
      eventBus.emit('toggleCursorRequested', hide);
    });

    ipcMain.on('toggle-model-picker', () => {
      eventBus.emit('toggleModelPickerRequested');
    });

    // ── Main -> Overlay (via Event Bus subscriptions) ────────────────
    eventBus.on('streamStart', (data) => this.sendToOverlay('stream-start', data));
    eventBus.on('streamChunk', (data) => this.sendToOverlay('stream-chunk', data));
    eventBus.on('streamFinished', (data) => {
      this.sendToOverlay('stream-end', data);
      eventBus.emit('voiceStateChanged', 'idle');
    });
    eventBus.on('streamError', (err) => {
      this.sendToOverlay('stream-error', err);
      eventBus.emit('voiceStateChanged', 'idle');
    });
    eventBus.on('userRequestCancelled', () => {
      eventBus.emit('voiceStateChanged', 'idle');
    });
    eventBus.on('voiceStateChanged', (state) => this.sendToOverlay('voice-state-changed', state));
    eventBus.on('modeSelected', (mode) => this.sendToOverlay('mode-selected', mode));
    eventBus.on('modelSwitchStarted', (data) => this.sendToOverlay('model-switch-started', data));
    eventBus.on('modelSwitchReady', (data) => this.sendToOverlay('model-switch-ready', data));

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
      return { 
        provider: stateManager.get('currentProvider'),
        screenshotDelays: stateManager.get('screenshotDelays')
      };
    });

    this.safeHandle('save-settings', (event, settings) => {
      if (settings.provider) {
        const oldProvider = stateManager.get('currentProvider');
        if (oldProvider !== settings.provider) {
          stateManager.set('currentProvider', settings.provider);
          eventBus.emit('providerSwitched', settings.provider);
        }
      }
      if (settings.screenshotDelays) {
        stateManager.set('screenshotDelays', settings.screenshotDelays);
      }
      return true;
    });

    this.safeHandle('get-auth-status', async (event, provider) => {
      const sessionManager = require('../providers/session-manager');
      return sessionManager.isAuthenticated(provider);
    });

    // ── Model picker: list models + switch ───────────────────────────
    this.safeHandle('get-model-list', () => {
      const capabilities = require('../providers/provider-capabilities');
      const sessionManager = require('../providers/session-manager');
      const current = stateManager.get('currentProvider') || 'chatgpt';
      const names = {
        chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', kimi: 'Kimi',
        deepseek: 'DeepSeek', perplexity: 'Perplexity', google: 'Google AI'
      };
      const ids = ['chatgpt', 'gemini', 'claude', 'kimi', 'deepseek', 'perplexity', 'google'];
      return ids.map((id) => ({
        id,
        name: names[id] || id,
        current: id === current,
        loggedIn: !!sessionManager.isAuthenticated(id),
        supportsImages: capabilities.hasCapability(id, 'supportsImages'),
      }));
    });

    this.safeHandle('select-model', (event, id) => {
      const current = stateManager.get('currentProvider') || 'chatgpt';
      if (!id || id === current) return false;
      stateManager.set('currentProvider', id);
      // openInput: true → open the input bar once the new model is ready.
      eventBus.emit('providerSwitched', id, { openInput: true });
      return true;
    });

    this.safeHandle('login-provider', (event, provider) => {
      const hiddenBrowserManager = require('../providers/hidden-browser-manager');
      // Show the hidden window so user can login manually
      hiddenBrowserManager.showForLogin(provider);
      return true;
    });

    // ── API Key Management Handlers ──────────────────────────────────
    this.safeHandle('generate-api-key', async (event, data) => {
      const { username, password, availableModels, conversationID } = data;
      if (!username || !password) {
        throw new Error('Username and password are required');
      }

      const crypto = require('crypto');
      const fs = require('fs');
      const path = require('path');

      // Helper to read .env
      const getEnvVar = (key) => {
        if (process.env[key]) return process.env[key];
        try {
          const envPath = path.join(__dirname, '../../.env');
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts[0].trim() === key) {
                  return parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
                }
              }
            }
          }
        } catch (e) {}
        return null;
      };

      const sbUrl = getEnvVar('SUPABASE_URL');
      const sbKey = getEnvVar('SUPABASE_KEY');
      if (!sbUrl || !sbKey) {
        throw new Error('Supabase configuration missing in .env');
      }

      // Generate a new secure API Key
      const rawKey = 'sk_copilot_' + crypto.randomBytes(24).toString('hex');

      // Insert as a special configuration row in 'conversations' table
      const headers = {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };

      // Hash password using SHA256
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      const body = {
        id: rawKey,
        owner_id: username,
        title: 'API_KEY',
        metadata: {
          type: 'api_key_config',
          username: username,
          password_hash: passwordHash,
          available_models: availableModels || ['*'],
          conversation_id: conversationID || ('conv_' + crypto.randomUUID()),
          status: 'active',
          created_at: new Date().toISOString()
        }
      };

      const res = await fetch(`${sbUrl}/rest/v1/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to save key in Supabase: ${errText}`);
      }

      return { success: true };
    });

    this.safeHandle('reveal-api-key', async (event, data) => {
      const { username, password } = data;
      if (!username || !password) {
        throw new Error('Username and password are required');
      }

      const crypto = require('crypto');
      const fs = require('fs');
      const path = require('path');

      const getEnvVar = (key) => {
        if (process.env[key]) return process.env[key];
        try {
          const envPath = path.join(__dirname, '../../.env');
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts[0].trim() === key) {
                  return parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
                }
              }
            }
          }
        } catch (e) {}
        return null;
      };

      const sbUrl = getEnvVar('SUPABASE_URL');
      const sbKey = getEnvVar('SUPABASE_KEY');
      if (!sbUrl || !sbKey) {
        throw new Error('Supabase configuration missing in .env');
      }

      const headers = {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json'
      };

      // Fetch by owner_id and title = 'API_KEY'
      const res = await fetch(`${sbUrl}/rest/v1/conversations?owner_id=eq.${encodeURIComponent(username)}&title=eq.API_KEY`, {
        headers
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to retrieve from Supabase: ${errText}`);
      }

      const results = await res.json();
      if (!results || results.length === 0) {
        throw new Error('No API key found for this user');
      }

      const keyConfig = results[0];
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      if (keyConfig.metadata.password_hash !== passwordHash) {
        throw new Error('Authentication failed: Invalid password');
      }

      return { apiKey: keyConfig.id };
    });

    this.safeHandle('get-api-keys', async () => {
      const fs = require('fs');
      const path = require('path');

      const getEnvVar = (key) => {
        if (process.env[key]) return process.env[key];
        try {
          const envPath = path.join(__dirname, '../../.env');
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts[0].trim() === key) {
                  return parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
                }
              }
            }
          }
        } catch (e) {}
        return null;
      };

      const sbUrl = getEnvVar('SUPABASE_URL');
      const sbKey = getEnvVar('SUPABASE_KEY');
      if (!sbUrl || !sbKey) {
        return [];
      }

      const headers = {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json'
      };

      const res = await fetch(`${sbUrl}/rest/v1/conversations?title=eq.API_KEY`, {
        headers
      });

      if (!res.ok) {
        return [];
      }

      const results = await res.json();
      return results.map(row => {
        const key = row.id;
        const masked = key.substring(0, 11) + '...' + key.substring(key.length - 4);
        return {
          id: row.id,
          maskedKey: masked,
          username: row.owner_id,
          models: row.metadata.available_models,
          conversationID: row.metadata.conversation_id,
          status: row.metadata.status,
          createdAt: row.metadata.created_at
        };
      });
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
