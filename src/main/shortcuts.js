const { globalShortcut } = require('electron');
const eventBus = require('./event-bus');
const contextEngine = require('./context-engine');
const captureModule = require('./capture');

/**
 * Global Shortcuts Module
 * 
 * Ctrl+Shift+Q     → Text-only question (no screenshot)
 * Ctrl+Shift+Space → Screenshot + question (captures screen first)
 * Ctrl+Shift+F     → Attach files (file picker) + describe your need
 * Ctrl+Shift+O     → Toggle overlay visibility
 * Ctrl+Shift+J     → Toggle projects panel
 * Ctrl+Shift+N     → New project
 * Ctrl+Shift+H     → Conversation history
 * Ctrl+Shift+M     → Model picker (select AI model from UI)
 * Ctrl+Alt+R       → Reload provider context
 * 
 * NOTE: Escape is handled per-window (overlay, input) to avoid
 * stealing the key system-wide from other applications.
 */
class ShortcutsModule {
  registerAll() {
    // Ctrl+Shift+Space → Capture screen + ask question about it
    const r1 = globalShortcut.register('CommandOrControl+Shift+Space', async () => {
      console.log('[Shortcut] Ctrl+Shift+Space pressed → Screen analyze');
      
      let screenshotCaptured = false;
      
      try {
        // Hide all UI first so the copilot doesn't capture itself
        eventBus.emit('hideAllUIRequested');
        
        // Wait for OS to repaint and hide windows (500ms is safe for most machines)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const cap = await captureModule.captureFullScreenDetailed();

        if (cap && cap.dataURL) {
          contextEngine.setPendingScreenshot(cap.dataURL, { width: cap.width, height: cap.height, displayIndex: cap.displayIndex });
          screenshotCaptured = true;
          console.log('[Shortcut] Screenshot captured and stored.');
        } else {
          console.warn('[Shortcut] captureFullScreen returned null — falling back to text-only.');
        }
      } catch (err) {
        console.error('[Shortcut] Failed to capture screen:', err.message);
      }
      
      eventBus.emit('showInputWithScreenshot', {
        prefill: screenshotCaptured 
          ? 'Analyze the content visible on the current screen. Describe what you see and provide relevant insights.'
          : '',
        hasScreenshot: screenshotCaptured
      });
    });
    console.log('[Shortcuts] Ctrl+Shift+Space registered:', r1);

    // Ctrl+Shift+Q → Text-only question (NO screenshot)
    const r2 = globalShortcut.register('CommandOrControl+Shift+Q', () => {
      console.log('[Shortcut] Ctrl+Shift+Q pressed → Text question');
      
      contextEngine.clearPendingScreenshot();
      
      eventBus.emit('showInputWithScreenshot', {
        prefill: '',
        hasScreenshot: false
      });
    });
    console.log('[Shortcuts] Ctrl+Shift+Q registered:', r2);

    // Ctrl+Shift+O → Toggle Overlay
    const r3 = globalShortcut.register('CommandOrControl+Shift+O', () => {
      console.log('[Shortcut] Ctrl+Shift+O pressed → Toggle overlay');
      eventBus.emit('toggleOverlayRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+O registered:', r3);

    // Ctrl+Shift+N → New Project
    const r4 = globalShortcut.register('CommandOrControl+Shift+N', () => {
      console.log('[Shortcut] Ctrl+Shift+N pressed → New project');
      eventBus.emit('newProjectRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+N registered:', r4);

    // Ctrl+Shift+J → Toggle Projects Panel
    // (Ctrl+Shift+P conflicts with VS Code Command Palette, Chrome DevTools, etc.)
    const r5 = globalShortcut.register('CommandOrControl+Shift+J', () => {
      console.log('[Shortcut] Ctrl+Shift+J pressed → Toggle projects');
      eventBus.emit('toggleProjectsRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+J registered:', r5);

    // Ctrl+Shift+H → Conversation History Picker
    const r6 = globalShortcut.register('CommandOrControl+Shift+H', () => {
      console.log('[Shortcut] Ctrl+Shift+H pressed → Conversation history');
      eventBus.emit('toggleConversationPickerRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+H registered:', r6);

    // Ctrl+Alt+R → Reload/Refresh AI Context
    // (Ctrl+Shift+R conflicts with browser hard reload)
    const rReload = globalShortcut.register('CommandOrControl+Alt+R', () => {
      console.log('[Shortcut] Ctrl+Alt+R pressed → Reload provider context');
      eventBus.emit('reloadProviderRequested');
    });
    console.log('[Shortcuts] Ctrl+Alt+R registered:', rReload);

    // Ctrl+Shift+M → Open the model picker (select a model from the UI)
    const rModel = globalShortcut.register('CommandOrControl+Shift+M', () => {
      console.log('[Shortcut] Ctrl+Shift+M pressed → Toggle model picker');
      eventBus.emit('toggleModelPickerRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+M registered:', rModel);

    // Ctrl+Shift+F → Attach files (opens a file picker, then the input bar)
    const rFiles = globalShortcut.register('CommandOrControl+Shift+F', () => {
      console.log('[Shortcut] Ctrl+Shift+F pressed → Attach files');
      eventBus.emit('attachFilesRequested');
    });
    console.log('[Shortcuts] Ctrl+Shift+F registered:', rFiles);



    // NOTE: Escape is intentionally NOT registered as a global shortcut.
    // Global Escape steals the key from every application on the system.
    // Instead, Escape is handled per-window in overlay.js and input.js.
  }

  unregisterAll() {
    globalShortcut.unregisterAll();
  }
}

module.exports = new ShortcutsModule();
