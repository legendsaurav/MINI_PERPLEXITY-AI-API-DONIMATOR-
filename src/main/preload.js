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

  // ── Input actions ───────────────────────────────────────────────────
  submitQuestion: (text) => ipcRenderer.send('submit-question', text),
  cancelRequest: () => ipcRenderer.send('cancel-request'),

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

  // ── Window controls ─────────────────────────────────────────────────
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  toggleProjects: () => ipcRenderer.send('toggle-projects'),
  toggleConversationPicker: () => ipcRenderer.send('toggle-conversation-picker'),
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
