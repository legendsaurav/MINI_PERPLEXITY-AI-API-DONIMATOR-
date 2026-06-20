const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script exclusively for the hidden AI BrowserWindow (ChatGPT/Gemini).
 * Provides the IPC bridge that allows injected DOM scripts to stream data back.
 * 
 * NOTE: Some websites (like ChatGPT) may have strict CSP that blocks contextBridge.
 * We expose via contextBridge if possible, and also attach to window directly as fallback.
 */

try {
  contextBridge.exposeInMainWorld('__aiCopilot', {
    sendChunk: (text) => ipcRenderer.send('ai-chunk', text),
    sendComplete: (data) => ipcRenderer.send('ai-complete', data),
    sendError: (err) => ipcRenderer.send('ai-error', err),
    sendReady: () => ipcRenderer.send('ai-ready'),
    sendConversationId: (id) => ipcRenderer.send('ai-conversation-id', id),
    sendAuthRequired: () => ipcRenderer.send('ai-auth-required'),
  });
  console.log('[AI Preload] contextBridge exposed successfully');
} catch (e) {
  console.warn('[AI Preload] contextBridge failed, using fallback:', e.message);
}

// Fallback: Inject directly into the page context via script tag
// This runs AFTER the page loads and ensures __aiCopilot is always available
const { webFrame } = require('electron');
webFrame.executeJavaScript(`
  if (!window.__aiCopilot) {
    console.log('[AI Preload Fallback] Injecting __aiCopilot bridge via webFrame');
    // We can't use ipcRenderer here directly, so we use postMessage as a relay
    window.__aiCopilot = {
      sendChunk: (text) => window.postMessage({ type: '__copilot_chunk', data: text }, '*'),
      sendComplete: (data) => window.postMessage({ type: '__copilot_complete', data: data }, '*'),
      sendError: (err) => window.postMessage({ type: '__copilot_error', data: err }, '*'),
      sendReady: () => window.postMessage({ type: '__copilot_ready' }, '*'),
    };
  }
`);

// Listen for postMessage relay from the page context
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case '__copilot_chunk':
      ipcRenderer.send('ai-chunk', msg.data);
      break;
    case '__copilot_sync':
      ipcRenderer.send('ai-sync', msg.data);
      break;
    case '__copilot_complete':
      ipcRenderer.send('ai-complete', msg.data);
      break;
    case '__copilot_error':
      ipcRenderer.send('ai-error', msg.data);
      break;
    case '__copilot_ready':
      ipcRenderer.send('ai-ready');
      break;
  }
});
