const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const stateManager = require('./state-manager');
const eventBus = require('./event-bus');
const ipcManager = require('./ipc-manager');
const shortcuts = require('./shortcuts');
const hiddenBrowserManager = require('../providers/hidden-browser-manager');
const sessionManager = require('../providers/session-manager');
const browserController = require('../providers/browser-controller');
const contextEngine = require('./context-engine');
const projectManager = require('./project-manager');
const contextDetector = require('./context-detector');
const providerCapabilities = require('../providers/provider-capabilities');

console.log('[Startup] Main process loaded');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Startup] Another instance running, quitting.');
  app.quit();
}

let tray = null;
let overlayWindow = null;
let inputWindow = null;
let projectsWindow = null;
let conversationPickerWindow = null;

function createOverlay() {
  console.log('[Startup] Creating Overlay window...');
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  const overlayPath = path.join(__dirname, '../overlay/overlay.html');
  console.log('[Startup] Loading overlay HTML from:', overlayPath);
  overlayWindow.loadFile(overlayPath);

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[Startup] Overlay HTML loaded successfully');
  });

  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Startup] Overlay FAILED to load:', errorCode, errorDescription);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createInputWindow() {
  console.log('[Startup] Creating Input window...');
  inputWindow = new BrowserWindow({
    width: 560,
    height: 72,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const inputPath = path.join(__dirname, '../input/input.html');
  console.log('[Startup] Loading input HTML from:', inputPath);
  inputWindow.loadFile(inputPath);

  inputWindow.webContents.on('did-finish-load', () => {
    console.log('[Startup] Input HTML loaded successfully');
  });

  inputWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Startup] Input FAILED to load:', errorCode, errorDescription);
  });

  inputWindow.on('blur', () => {
    if (inputWindow) inputWindow.hide();
  });

  inputWindow.on('closed', () => {
    inputWindow = null;
  });
}

function createProjectsWindow() {
  console.log('[Startup] Creating Projects window...');
  projectsWindow = new BrowserWindow({
    width: 480,
    height: 650,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  projectsWindow.setAlwaysOnTop(true, 'screen-saver');

  const projectsPath = path.join(__dirname, '../projects/projects.html');
  console.log('[Startup] Loading projects HTML from:', projectsPath);
  projectsWindow.loadFile(projectsPath);

  projectsWindow.webContents.on('did-finish-load', () => {
    console.log('[Startup] Projects HTML loaded successfully');
  });

  projectsWindow.on('closed', () => {
    projectsWindow = null;
  });
}

function createTray() {
  console.log('[Startup] Creating Tray icon...');

  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r) {
        canvas[idx]     = 107;
        canvas[idx + 1] = 76;
        canvas[idx + 2] = 255;
        canvas[idx + 3] = 255;
      } else {
        canvas[idx + 3] = 0;
      }
    }
  }
  const icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });

  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Universal AI Copilot', enabled: false },
    { type: 'separator' },
    { label: 'Projects', click: () => { eventBus.emit('toggleProjectsRequested'); } },
    { label: 'New Project', click: () => { eventBus.emit('newProjectRequested'); } },
    { type: 'separator' },
    { label: 'Toggle Overlay', click: () => { eventBus.emit('toggleOverlayRequested'); } },
    { label: 'Re-Login', click: () => { runConnectionCheckpoints(true); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } }
  ]);
  
  tray.setToolTip('Universal Desktop AI Copilot');
  tray.setContextMenu(contextMenu);
  console.log('[Startup] Tray icon created');
}

function createConversationPicker() {
  console.log('[Startup] Creating Conversation Picker window...');
  conversationPickerWindow = new BrowserWindow({
    width: 520,
    height: 500,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  conversationPickerWindow.setAlwaysOnTop(true, 'screen-saver');

  const pickerPath = path.join(__dirname, '../conversations/conversations.html');
  console.log('[Startup] Loading conversations HTML from:', pickerPath);
  conversationPickerWindow.loadFile(pickerPath);

  conversationPickerWindow.webContents.on('did-finish-load', () => {
    console.log('[Startup] Conversations HTML loaded successfully');
  });

  conversationPickerWindow.on('blur', () => {
    if (conversationPickerWindow) conversationPickerWindow.hide();
  });

  conversationPickerWindow.on('closed', () => {
    conversationPickerWindow = null;
  });
}

// ============================================================
// 3-CHECKPOINT CONNECTION FLOW
// ============================================================

async function runConnectionCheckpoints(forceShow = false) {
  const providers = ['chatgpt', 'gemini', 'claude', 'kimi', 'deepseek', 'googlesearch'];
  const startProvider = stateManager.get('currentProvider') || 'chatgpt';

  console.log('');
  console.log('[Connection] ================================================');
  console.log(`[Connection] Starting multi-provider sequential startup check (forceShow: ${forceShow})...`);
  console.log('[Connection] ================================================');

  const checkSequence = async () => {
    for (const provider of providers) {
      try {
        console.log(`[Connection] [${provider}] Initializing hidden browser...`);
        const win = await hiddenBrowserManager.ensureWindow(provider);
        
        // Wait for page load
        await sleep(3000);
        
        let isAuth = await sessionManager.checkAuthStatus(provider, win.webContents);
        console.log(`[Connection] [${provider}] Auth status: ${isAuth}`);

        if (!isAuth) {
          console.log(`[Connection] [${provider}] ⚠ User is NOT logged in. Showing login window...`);
          hiddenBrowserManager.showForLogin(provider);

          // Wait for the user to login (blocks processing the next provider until resolved)
          const loggedIn = await waitForLogin(provider, win);
          if (!loggedIn) {
            console.error(`[Connection] [${provider}] ✗ Login check timed out or cancelled.`);
            continue;
          }
          console.log(`[Connection] [${provider}] ✓ Logged in successfully!`);
        } else {
          console.log(`[Connection] [${provider}] ✓ Already logged in.`);
          if (forceShow) {
            hiddenBrowserManager.showForLogin(provider);
          }
        }

        // Send the test message "hi" to verify the model is working and responding properly
        console.log(`[Connection] [${provider}] Sending test message "hi"...`);
        try {
          const fullResponse = await sendTestMessage(provider, 'hi');
          console.log(`[Connection] [${provider}] ✓ Test response received: "${fullResponse.substring(0, 45).replace(/\n/g, ' ')}..."`);
          
          if (overlayWindow && !overlayWindow.isDestroyed() && provider === startProvider) {
            overlayWindow.webContents.send('stream-end', { fullText: fullResponse });
          }

          console.log(`[Connection] [${provider}] ✓ Provider verified successfully!`);
          
          // Successfully logged in & verified -> hide the window
          hiddenBrowserManager.hideAfterLogin(provider);
        } catch (verifyError) {
          console.warn(`[Connection] [${provider}] ⚠ Verification failed:`, verifyError.message);
          // Keep/show the window so the user can see what's wrong (e.g. CAPTCHA, browser suspended, etc.)
          hiddenBrowserManager.showForLogin(provider);
        }

      } catch (error) {
        console.error(`[Connection] [${provider}] Error during verification:`, error.message);
      }
    }
    console.log('[Connection] Multi-provider sequential startup check complete.');
    console.log('[Connection] ================================================');

    // Show a desktop notification to inform the user the Copilot is ready
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({
          title: 'Universal AI Copilot',
          body: 'All providers verified. Copilot is ready! Press Ctrl+Shift+O to open.',
          silent: true
        }).show();
      }
    } catch (err) {
      // Ignore
    }
  };

  // Run sequentially in background so it does not block application window creation
  checkSequence();

  return true;
}

async function waitForLogin(provider, win) {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(3000);
    
    try {
      const isAuth = await sessionManager.checkAuthStatus(provider, win.webContents);
      if (isAuth) {
        return true;
      }
      
      if (i % 5 === 0) {
        console.log(`[Connection] Still waiting for login... (${i * 3}s elapsed)`);
      }
    } catch (error) {
      // Page might be navigating, just continue polling
    }
  }
  return false;
}

function sendTestMessage(provider, message) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Test message timed out after 60 seconds'));
    }, 60000);

    let fullText = '';

    const onChunk = (event, chunk) => {
      fullText += chunk;
      console.log(`[Connection] Receiving response... (${fullText.length} chars)`);
    };

    const onComplete = (event, data) => {
      clearTimeout(timeout);
      cleanup();
      if (data && data.fullText) {
        resolve(data.fullText);
      } else {
        resolve(fullText || '(empty response)');
      }
    };

    const onError = (event, err) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(err || 'Stream error'));
    };

    function cleanup() {
      ipcMain.removeListener('ai-chunk', onChunk);
      ipcMain.removeListener('ai-complete', onComplete);
      ipcMain.removeListener('ai-error', onError);
    }

    ipcMain.on('ai-chunk', onChunk);
    ipcMain.on('ai-complete', onComplete);
    ipcMain.on('ai-error', onError);

    try {
      await browserController.attachStreamObserver(provider);
      await sleep(500);
      await browserController.injectAndSubmit(provider, message);
      console.log('[Connection] Test message "hi" injected and submitted.');
    } catch (error) {
      clearTimeout(timeout);
      cleanup();
      reject(error);
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// AI PIPELINE SETUP
// ============================================================

function setupAIPipeline() {
  console.log('[Pipeline] Setting up AI pipeline...');

  require('./request-manager');
  require('./stream-manager');

  const BrowserProvider = require('../providers/browser-provider');
  let currentProvider = stateManager.get('currentProvider') || 'chatgpt';
  let browserProviderInstance = new BrowserProvider(currentProvider);
  
  console.log(`[Pipeline] BrowserProvider created for: ${currentProvider}`);

  // Ensure the hidden browser window for the startup provider is loaded
  const hiddenBrowserManager = require('../providers/hidden-browser-manager');
  hiddenBrowserManager.ensureWindow(currentProvider).catch(err => {
    console.error(`[Pipeline] Failed to ensure window for ${currentProvider}:`, err.message);
  });

  // Handle dynamic provider switching
  eventBus.on('providerSwitched', async (newProvider) => {
    console.log(`[Pipeline] Switching AI provider to: ${newProvider}`);
    currentProvider = newProvider;
    // Cleanup old provider if necessary (e.g., stop observers)
    if (browserProviderInstance.shutdown) {
      browserProviderInstance.shutdown();
    }
    browserProviderInstance = new BrowserProvider(currentProvider);
    
    // Ensure the new hidden browser window is initialized
    const win = await hiddenBrowserManager.ensureWindow(currentProvider);
    
    // Wait a brief moment for navigation/redirects
    await sleep(2000);
    
    // If not authenticated, show the login page
    const sessionManager = require('../providers/session-manager');
    let isAuth = await sessionManager.checkAuthStatus(currentProvider, win.webContents);
    
    if (!isAuth) {
      console.log(`[Pipeline] User is NOT logged into ${currentProvider}. Showing login window...`);
      hiddenBrowserManager.showForLogin(currentProvider);
      
      // Wait for the user to login
      isAuth = await waitForLogin(currentProvider, win);
      
      if (isAuth) {
        console.log(`[Pipeline] Successfully logged into ${currentProvider}. Hiding window...`);
        hiddenBrowserManager.hideAfterLogin(currentProvider);
      } else {
        console.log(`[Pipeline] Login for ${currentProvider} timed out or failed.`);
      }
    } else {
      console.log(`[Pipeline] User is already logged into ${currentProvider}.`);
    }
    
    console.log(`[Pipeline] AI provider switched successfully.`);
  });

  // ============================================================
  // CORE WIRING: Connect requestStarted → AI prompt injection
  // ============================================================
  eventBus.on('requestStarted', async (question) => {
    try {
      console.log(`[Pipeline] New request received: "${question.substring(0, 60)}..."`);
      
      console.log('[Pipeline] Building context...');
      const contextObject = await contextEngine.buildContext(question);
      console.log('[Pipeline] Context built. Checking auth status...');
      
      const win = hiddenBrowserManager.getWindow(currentProvider);
      if (!win || win.isDestroyed()) {
        throw new Error(`Hidden browser window not available for ${currentProvider}. Please use tray menu → Re-Login.`);
      }

      const sessionManager = require('../providers/session-manager');
      let isAuth = await sessionManager.checkAuthStatus(currentProvider, win.webContents);
      
      if (!isAuth) {
        console.log(`[Pipeline] User is NOT logged into ${currentProvider}. Showing login window...`);
        hiddenBrowserManager.showForLogin(currentProvider);
        
        // Wait for user to log in
        isAuth = await waitForLogin(currentProvider, win);
        
        if (isAuth) {
          console.log(`[Pipeline] Successfully logged into ${currentProvider}. Hiding window and continuing...`);
          hiddenBrowserManager.hideAfterLogin(currentProvider);
          await sleep(2000); // Wait for page stability
        } else {
          throw new Error(`Please log in first. The login page for ${currentProvider} has been opened.`);
        }
      }

      await browserProviderInstance.sendPrompt(contextObject);
      console.log('[Pipeline] Prompt sent to AI successfully.');

      // Increment interaction count for the active project
      const activeProject = stateManager.get('currentProject');
      if (activeProject) {
        await projectManager.incrementInteraction(activeProject);
      }

      // Capture conversation URL from the hidden browser after a short delay
      setTimeout(async () => {
        try {
          const win = hiddenBrowserManager.getWindow(currentProvider);
          if (win && !win.isDestroyed()) {
            const url = win.webContents.getURL();
            const title = win.webContents.getTitle();
            // Extract conversation path (e.g. /c/6a27c9aa-...)
            const urlObj = new URL(url);
            const convPath = urlObj.pathname;
            
            if (activeProject && convPath && convPath.startsWith('/c/')) {
              await projectManager.updateConversationRef(activeProject, convPath, title);
              console.log(`[Pipeline] Conversation URL captured: ${convPath}`);
              eventBus.emit('projectChanged', { project_name: activeProject });
            }
          }
        } catch (e) {
          // Non-critical, don't crash
          console.log('[Pipeline] Could not capture conversation URL:', e.message);
        }
      }, 3000);

    } catch (error) {
      console.error('[Pipeline] Error sending prompt:', error.message);
      eventBus.emit('streamError', { error: error.message });
    }
  });

  // ============================================================
  // EVENT: Show overlay when a new request starts
  // ============================================================
  eventBus.on('showOverlayRequested', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (!overlayWindow.isVisible()) {
        overlayWindow.show();
        stateManager.set('overlayVisibility', true);
        console.log('[Overlay] Shown for new request');
      }
    }
  });

  // ============================================================
  // AUTO-CONTEXT DETECTION
  // ============================================================
  eventBus.on('contextChanged', async (context) => {
    console.log(`[Context] Auto-detected: ${context.ucid} (${context.displayName})`);
    
    // Auto-project switching disabled temporarily for testing stability
    try {
      const project = await projectManager.getOrCreateByUCID(context.ucid, context.displayName);
      const currentProject = stateManager.get('currentProject');
      
      if (project.project_name !== currentProject) {
        console.log(`[Context] Auto-switching project: ${currentProject} → ${project.project_name}`);
        await projectManager.switchProject(project.project_name);
        eventBus.emit('contextAutoSwitched', { 
          project: project, 
          context: context 
        });
      }
    } catch (err) {
      console.error('[Context] Failed to auto-switch project:', err.message);
    }
  });

  // Start context detection after pipeline is ready
  contextDetector.start();
  console.log('[Pipeline] Context detector started.');

  // ============================================================
  // PROJECT SHORTCUTS
  // ============================================================
  eventBus.on('newProjectRequested', () => {
    console.log('[Project] New project requested');
    // Show projects window and trigger new project dialog
    if (projectsWindow && !projectsWindow.isDestroyed()) {
      projectsWindow.show();
      projectsWindow.webContents.send('show-new-project-dialog');
    }
  });

  eventBus.on('switchProjectRequested', () => {
    console.log('[Project] Switch project requested — toggling projects panel');
    eventBus.emit('toggleProjectsRequested');
  });

  // Open conversation in hidden browser
  eventBus.on('openConversationRequested', async (projectName) => {
    try {
      const project = await projectManager.getProject(projectName);
      if (project && project.conversation_reference) {
        const win = hiddenBrowserManager.getWindow(currentProvider);
        if (win && !win.isDestroyed()) {
          const caps = providerCapabilities.getCapabilities(currentProvider);
          const baseUrl = caps ? caps.baseUrl : 'https://chatgpt.com';
          const fullUrl = baseUrl + project.conversation_reference;
          await win.webContents.loadURL(fullUrl);
          console.log(`[Project] Opened conversation: ${fullUrl}`);
        }
      } else {
        console.log(`[Project] No conversation linked for: ${projectName}`);
      }
    } catch (err) {
      console.error('[Project] Failed to open conversation:', err.message);
    }
  });

  console.log('[Pipeline] ✓ AI pipeline fully wired and ready.');
}

// ============================================================
// MAIN STARTUP
// ============================================================

app.whenReady().then(async () => {
  console.log('[Startup] App Ready');

  // Initialize Core Infrastructure
  ipcManager.initialize();
  console.log('[Startup] IPC Initialized');
  
  // Create windows
  createOverlay();
  console.log('[Startup] Overlay Created');

  createInputWindow();
  console.log('[Startup] Input Window Created');

  createProjectsWindow();
  console.log('[Startup] Projects Window Created');

  createConversationPicker();
  console.log('[Startup] Conversation Picker Created');
  
  // Register windows with IPC Manager (4 windows now)
  ipcManager.registerWindows(overlayWindow, inputWindow, null, projectsWindow);
  console.log('[Startup] Windows registered with IPC Manager');

  createTray();
  console.log('[Startup] Tray Created');

  shortcuts.registerAll();
  console.log('[Startup] Shortcuts registered');

  // Setup Event Listeners
  eventBus.on('toggleOverlayRequested', () => {
    console.log('[Event] toggleOverlayRequested');
    if (overlayWindow) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
        stateManager.set('overlayVisibility', false);
        console.log('[Overlay] Hidden');
      } else {
        overlayWindow.show();
        stateManager.set('overlayVisibility', true);
        console.log('[Overlay] Shown');
      }
    } else {
      console.warn('[Overlay] Window is null!');
    }
  });

  // Hide ALL UI (used before taking screenshots)
  eventBus.on('hideAllUIRequested', () => {
    console.log('[Event] hideAllUIRequested');
    if (overlayWindow && overlayWindow.isVisible()) overlayWindow.hide();
    if (inputWindow && inputWindow.isVisible()) inputWindow.hide();
    if (projectsWindow && projectsWindow.isVisible()) projectsWindow.hide();
    if (conversationPickerWindow && conversationPickerWindow.isVisible()) conversationPickerWindow.hide();
  });

  // Session Ended (triggered when user ends a frozen context session)
  eventBus.on('sessionEnded', () => {
    console.log('[Event] sessionEnded — clearing frozen context and hiding overlay');
    if (overlayWindow && overlayWindow.isVisible()) {
      overlayWindow.hide();
      stateManager.set('overlayVisibility', false);
    }
  });

  // Reload Provider
  eventBus.on('reloadProviderRequested', () => {
    console.log('[Event] reloadProviderRequested');
    const currentProv = stateManager.get('currentProvider') || 'chatgpt';
    const hiddenBrowserManager = require('../providers/hidden-browser-manager');
    if (hiddenBrowserManager.reloadWindow(currentProv)) {
      eventBus.emit('userRequestCancelled');
      if (overlayWindow && overlayWindow.isVisible()) overlayWindow.hide();
    }
  });

  // Toggle Projects panel
  eventBus.on('toggleProjectsRequested', () => {
    console.log('[Event] toggleProjectsRequested');
    if (projectsWindow) {
      if (projectsWindow.isVisible()) {
        projectsWindow.hide();
        console.log('[Projects] Hidden');
      } else {
        projectsWindow.show();
        console.log('[Projects] Shown');
      }
    } else {
      console.warn('[Projects] Window is null!');
    }
  });

  // Toggle Conversation Picker
  eventBus.on('toggleConversationPickerRequested', () => {
    console.log('[Event] toggleConversationPickerRequested');
    if (conversationPickerWindow) {
      if (conversationPickerWindow.isVisible()) {
        conversationPickerWindow.hide();
        console.log('[Conversations] Hidden');
      } else {
        // Reload conversations from ChatGPT sidebar each time we show
        conversationPickerWindow.show();
        conversationPickerWindow.focus();
        conversationPickerWindow.webContents.reload();
        console.log('[Conversations] Shown');
      }
    }
  });

  eventBus.on('showInputRequested', () => {
    console.log('[Event] showInputRequested');
    if (inputWindow) {
      inputWindow.show();
      inputWindow.webContents.send('show-input', { prefill: '', hasScreenshot: false });
      console.log('[Input] Window shown');
    } else {
      console.warn('[Input] Window is null!');
    }
  });

  eventBus.on('showInputWithScreenshot', (data) => {
    console.log('[Event] showInputWithScreenshot');
    if (inputWindow) {
      inputWindow.show();
      inputWindow.webContents.send('show-input', {
        prefill: data.prefill || '',
        hasScreenshot: data.hasScreenshot || false
      });
      console.log('[Input] Window shown with screenshot context');
    } else {
      console.warn('[Input] Window is null!');
    }
  });

  eventBus.on('userQuestionSubmitted', (question) => {
    console.log('[Event] userQuestionSubmitted:', question.substring(0, 50) + '...');
  });

  console.log('[Startup] ========================================');
  console.log('[Startup] All UI systems initialized!');
  console.log('[Startup] ========================================');
  console.log('[Startup] Now running AI connection checkpoints...');
  console.log('');

  // Run the 3-checkpoint connection flow
  const checkpointsPassed = await runConnectionCheckpoints();

  // Setup the AI pipeline REGARDLESS of checkpoint result
  setupAIPipeline();

  if (!checkpointsPassed) {
    console.log('[Startup] ⚠ Checkpoints did not fully pass.');
    console.log('[Startup] The pipeline is ready — once you log in, shortcuts will work.');
    console.log('[Startup] Use tray menu → Re-Login to try again.');
  }

  console.log('[Startup] ========================================');
  console.log('[Startup] Shortcuts:');
  console.log('[Startup]   Ctrl+Shift+Q     -> Ask question (text only)');
  console.log('[Startup]   Ctrl+Shift+Space -> Screenshot + question');
  console.log('[Startup]   Ctrl+Shift+O     -> Toggle overlay');
  console.log('[Startup]   Ctrl+Shift+J     -> Toggle projects panel');
  console.log('[Startup]   Ctrl+Shift+H     -> Conversation history');
  console.log('[Startup]   Ctrl+Shift+N     -> New project');
  console.log('[Startup]   Ctrl+Alt+R       -> Reload provider context');
  console.log('[Startup]   Escape (in-app)  -> Cancel / dismiss');
  console.log('[Startup] ========================================');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlay();
      createInputWindow();
      createProjectsWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  shortcuts.unregisterAll();
  contextDetector.stop();
  console.log('[Shutdown] Shortcuts unregistered. Context detector stopped. Goodbye.');
});

// ============================================================
// DEBUG: HTTP trigger for automated testing
// Allows triggering shortcut events via: curl http://localhost:9876/trigger?event=screenshot
// Remove this block for production builds.
// ============================================================
const http = require('http');
const captureModule = require('./capture');
const debugServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:9876');
  const action = url.pathname;

  res.setHeader('Content-Type', 'application/json');

  // --- API Key Authentication ---
  const providedKey = url.searchParams.get('api_key') || req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  const expectedKey = stateManager.get('apiKey');

  if (providedKey !== expectedKey) {
    console.warn(`[DEBUG-HTTP] Unauthorized API access attempt. Key provided: ${providedKey ? '***' : 'none'}`);
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing API Key.' }));
  }
  // ------------------------------

  try {
    if (action === '/trigger/screenshot') {
      // Simulate the full Ctrl+Shift+Space flow
      console.log('[DEBUG-HTTP] Triggering screenshot flow...');
      eventBus.emit('hideAllUIRequested');
      await new Promise(r => setTimeout(r, 500));
      const screenshot = await captureModule.captureFullScreen();
      if (screenshot) {
        contextEngine.setPendingScreenshot(screenshot);
        console.log('[DEBUG-HTTP] Screenshot captured.');
      }
      eventBus.emit('showInputWithScreenshot', {
        prefill: 'analysis the image and tell what i am doing',
        hasScreenshot: !!screenshot
      });
      res.end(JSON.stringify({ ok: true, action: 'screenshot', hasScreenshot: !!screenshot }));

    } else if (action === '/trigger/submit') {
      // Simulate typing + Enter in input window
      const question = url.searchParams.get('q') || 'analysis the image and tell what i am doing';
      console.log(`[DEBUG-HTTP] Submitting question: "${question}"`);
      eventBus.emit('userQuestionSubmitted', question);
      res.end(JSON.stringify({ ok: true, action: 'submit', question }));

    } else if (action === '/trigger/screenshot-and-submit') {
      // Full E2E: screenshot → store → submit question
      const question = url.searchParams.get('q') || 'analysis the image and tell what i am doing';
      console.log(`[DEBUG-HTTP] Full E2E: screenshot + submit "${question}"`);
      eventBus.emit('hideAllUIRequested');
      await new Promise(r => setTimeout(r, 500));
      const screenshot = await captureModule.captureFullScreen();
      if (screenshot) {
        contextEngine.setPendingScreenshot(screenshot);
        console.log('[DEBUG-HTTP] Screenshot stored.');
      } else {
        console.warn('[DEBUG-HTTP] Screenshot returned null.');
      }
      // Directly submit — skip the input window for automated test
      eventBus.emit('userQuestionSubmitted', question);
      res.end(JSON.stringify({ ok: true, action: 'screenshot-and-submit', hasScreenshot: !!screenshot, question }));

    } else if (action === '/status') {
      const state = stateManager.get();
      res.end(JSON.stringify({ ok: true, state }));

    } else if (action === '/debug/set') {
      const key = url.searchParams.get('key');
      const value = url.searchParams.get('value');
      console.log(`[DEBUG-HTTP] Setting state key "${key}" to "${value}"`);
      stateManager.set(key, value);
      res.end(JSON.stringify({ ok: true, key, value }));

    } else if (action === '/debug/dom') {
      // Inspect the hidden browser DOM for file upload elements
      const currentProvider = stateManager.get('currentProvider') || 'chatgpt';
      const hiddenBrowserManager = require('../providers/hidden-browser-manager');
      const win = hiddenBrowserManager.getWindow(currentProvider);
      if (!win) {
        res.end(JSON.stringify({ error: 'No hidden browser window' }));
        return;
      }
      const domInfo = await win.webContents.executeJavaScript(`
        (function() {
          const fileInputs = document.querySelectorAll('input[type="file"]');
          const buttons = document.querySelectorAll('button');
          const uploadButtons = [];
          buttons.forEach(b => {
            const text = b.textContent.trim().toLowerCase();
            const aria = b.getAttribute('aria-label') || '';
            if (text.includes('upload') || text.includes('attach') || text.includes('file') || 
                aria.includes('upload') || aria.includes('attach') || aria.includes('file') ||
                aria.includes('Attach')) {
              uploadButtons.push({ text: text.substring(0, 50), aria, tag: b.tagName, classes: b.className.substring(0, 100) });
            }
          });
          
          // Look for any dropzone or upload-related elements
          const dropzones = document.querySelectorAll('[class*="drop"], [class*="upload"], [data-testid*="upload"], [data-testid*="attach"]');
          const dropzoneInfo = [];
          dropzones.forEach(d => {
            dropzoneInfo.push({ tag: d.tagName, classes: d.className.substring(0, 100), id: d.id, testid: d.getAttribute('data-testid') });
          });
          
          return {
            fileInputCount: fileInputs.length,
            fileInputs: Array.from(fileInputs).map(fi => ({
              accept: fi.getAttribute('accept'),
              multiple: fi.multiple,
              hidden: fi.offsetParent === null,
              style: fi.getAttribute('style'),
              classes: fi.className,
              parentTag: fi.parentElement ? fi.parentElement.tagName : null
            })),
            uploadButtons,
            dropzones: dropzoneInfo,
            composerArea: !!document.querySelector('#prompt-textarea'),
            attachButton: !!document.querySelector('button[aria-label*="ttach"]')
          };
        })();
      `);
      res.end(JSON.stringify({ ok: true, domInfo }, null, 2));

    } else if (action === '/debug/eval') {
      const currentProvider = stateManager.get('currentProvider') || 'chatgpt';
      const hiddenBrowserManager = require('../providers/hidden-browser-manager');
      const win = hiddenBrowserManager.getWindow(currentProvider);
      if (!win) {
        res.end(JSON.stringify({ error: 'No hidden browser window' }));
        return;
      }
      const code = url.searchParams.get('js');
      console.log(`[DEBUG-HTTP] Evaluating code: ${code}`);
      const result = await win.webContents.executeJavaScript(code);
      res.end(JSON.stringify({ ok: true, result }, null, 2));

    } else if (action === '/debug/hide') {
      console.log('[DEBUG-HTTP] Hiding all UI and provider browser windows...');
      eventBus.emit('hideAllUIRequested');
      const hiddenBrowserManager = require('../providers/hidden-browser-manager');
      for (const [provider, win] of hiddenBrowserManager.windows.entries()) {
        if (win && !win.isDestroyed()) {
          win.hide();
        }
      }
      res.end(JSON.stringify({ ok: true, action: 'hide' }));

    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Unknown action. Use /trigger/screenshot, /trigger/submit, /trigger/screenshot-and-submit, /debug/dom, /debug/eval, /debug/hide, or /status' }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

debugServer.listen(9876, '127.0.0.1', () => {
  console.log('[DEBUG] HTTP test server listening on http://127.0.0.1:9876');
});
