const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for Overlay, Input Popup, Settings, and Projects windows.
 * Exposes a safe API for renderers to communicate with the Main process.
 */
contextBridge.exposeInMainWorld('copilotAPI', {
  // ── Streaming events (Overlay listens) ──────────────────────────────
  onStreamChunk: (cb) => ipcRenderer.on('stream-chunk', (_, data) => cb(data)),
  onStreamStart: (cb) => ipcRenderer.on('stream-start', (_, data) => cb(data)),
  onStreamEnd: (cb) => ipcRenderer.on('stream-end', (_, data) => cb(data)),
  onStreamError: (cb) => ipcRenderer.on('stream-error', (_, data) => cb(data)),
  onVoiceStateChanged: (cb) => ipcRenderer.on('voice-state-changed', (_, state) => cb(state)),
  onModeSelected: (cb) => ipcRenderer.on('mode-selected', (_, mode) => cb(mode)),
  onModelSwitchStarted: (cb) => ipcRenderer.on('model-switch-started', (_, data) => cb(data)),
  onModelSwitchReady: (cb) => ipcRenderer.on('model-switch-ready', (_, data) => cb(data)),
  onDrawPointer: (cb) => ipcRenderer.on('draw-pointer', (_, data) => cb(data)),

  // ── Model picker ────────────────────────────────────────────────────
  getModelList: () => ipcRenderer.invoke('get-model-list'),
  selectModel: (id) => ipcRenderer.invoke('select-model', id),
  toggleModelPicker: () => ipcRenderer.send('toggle-model-picker'),
  notifyVoiceState: (state) => ipcRenderer.send('notify-voice-state', state),

  // ── Input actions ───────────────────────────────────────────────────
  submitQuestion: (text) => ipcRenderer.send('submit-question', text),
  cancelRequest: () => ipcRenderer.send('cancel-request'),

  // ── Agent actions ───────────────────────────────────────────────────
  stopAgent: () => ipcRenderer.send('stop-agent'),
  onAgentStarted: (cb) => ipcRenderer.on('agent-started', (_, data) => cb(data)),
  onAgentProgress: (cb) => ipcRenderer.on('agent-progress', (_, data) => cb(data)),
  onAgentFinished: (cb) => ipcRenderer.on('agent-finished', (_, data) => cb(data)),

  // ── Project CRUD ────────────────────────────────────────────────────
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  switchProject: (name) => ipcRenderer.invoke('switch-project', name),
  getActiveProject: () => ipcRenderer.invoke('get-active-project'),
  deleteProject: (name) => ipcRenderer.invoke('delete-project', name),
  renameProject: (oldName, newName) => ipcRenderer.invoke('rename-project', oldName, newName),

  // ── Conversation management ─────────────────────────────────────────
  getConversationHistory: () => ipcRenderer.invoke('get-conversation-history'),
  openConversation: (projectName) => ipcRenderer.invoke('open-conversation', projectName),
  unlinkConversation: (projectName) => ipcRenderer.invoke('unlink-conversation', projectName),
  reassignConversation: (projectName, data) => ipcRenderer.invoke('reassign-conversation', projectName, data),

  // ── Settings & Auth ─────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  loginProvider: (provider) => ipcRenderer.invoke('login-provider', provider),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),
  generateApiKey: (data) => ipcRenderer.invoke('generate-api-key', data),
  revealApiKey: (data) => ipcRenderer.invoke('reveal-api-key', data),
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),

  // ── Window controls ─────────────────────────────────────────────────
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  toggleProjects: () => ipcRenderer.send('toggle-projects'),
  toggleConversationPicker: () => ipcRenderer.send('toggle-conversation-picker'),
  triggerPointer: (data) => ipcRenderer.send('trigger-pointer', data),
  toggleCursor: (hide) => ipcRenderer.send('toggle-cursor', hide),
  onShowInput: (cb) => ipcRenderer.on('show-input', (_, data) => cb(data)),
  onProjectUpdated: (cb) => ipcRenderer.on('project-updated', (_, data) => cb(data)),
  onProjectsUpdated: (cb) => ipcRenderer.on('projects-updated', (_, data) => cb(data)),
  onContextChanged: (cb) => ipcRenderer.on('context-changed', (_, data) => cb(data)),
  onProviderSwitched: (cb) => ipcRenderer.on('provider-switched', (_, data) => cb(data)),

  // ── Conversation picker ────────────────────────────────────────────
  getConversationList: () => ipcRenderer.invoke('get-conversation-list'),
  selectConversation: (url, title) => ipcRenderer.invoke('select-conversation', url, title),
  onConversationsLoaded: (cb) => ipcRenderer.on('conversations-loaded', (_, data) => cb(data)),
});
