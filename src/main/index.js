const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
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
const intentRouter = require('./intent-router');
const promptComposer = require('./prompt-composer');
const fileAttachment = require('./file-attachment');
const conversationMemory = require('./conversation-memory');
const providerCapabilities = require('../providers/provider-capabilities');
const taskHandler = require('./task-handler');
// captureModule is required lower in this file (HTTP debug block); reused here.

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
let modelPickerWindow = null;
let pointerWindow = null;
let pythonTrayProcess = null;
// Agent lifecycle is managed by task-handler.js; these are kept as aliases.
let agentProcess = null;
let agentRunning = false;

// ============================================================
// TASK CLASSIFIER — Detect if user input is a desktop task or a question
// ============================================================
function classifyAsTask(text) {
  const t = text.trim().toLowerCase();
  const taskPatterns = [
    /^(open|launch|start|run|close|minimize|maximize|restore)\b/,
    /^(click|double[- ]?click|right[- ]?click|tap|press)\b/,
    /^(type|write|enter|input|fill)\s/,
    /^(search\s+for|find\s+and|look\s+for|browse\s+to|navigate\s+to|go\s+to)\b/,
    /^(perform|do|execute|carry\s+out)\b/,
    /^(create|make|new)\s+(a\s+)?(folder|file|document|shortcut)/,
    /^(delete|remove|move|copy|paste|rename|drag)\b/,
    /^(install|uninstall|download|upload)\b/,
    /^(play|pause|stop|mute|unmute)\s/,
    /^(set|change|adjust|configure|switch\s+to|turn\s+on|turn\s+off)\b/,
    /^(show|hide|toggle)\s+(me\s+)?(the\s+)?(desktop|taskbar|start\s*menu|this\s*pc)/,
    /^(pin|unpin)\b/,
    /^(scroll|swipe|zoom)\b/,
  ];
  return taskPatterns.some(p => p.test(t));
}

// Deterministic gate shared by the userQuestionSubmitted handler (which launches
// the agent) and the requestStarted handler (which skips the AI pipeline). Both
// compute the SAME answer from the same inputs, so there is no flag/race between
// the two userQuestionSubmitted listeners. A prompt only goes to the desktop
// automation agent when it's a clear OS task AND intent routing isn't confident
// it's a chat/guide request (so "show me the save button" stays a guide query).
function shouldRouteToAgent(question) {
  if (!classifyAsTask(question)) return false;
  
  // If the query explicitly asks to be shown or locate something, keep it in the visual guider mode.
  const t = question.toLowerCase();
  const guideKeywords = ['where', 'show', 'locate', 'highlight', 'point', 'find', 'navigate', 'guide', 'which button', 'which icon'];
  if (guideKeywords.some(kw => t.includes(kw))) {
    return false;
  }
  
  // Otherwise, it is an execution task (e.g. "open this pc", "run...", "click...") -> launch the agent!
  return true;
}

// ============================================================
// AGENT MANAGEMENT — Spawn/stop the autonomous Python agent
// ============================================================
function getWindowHwnds() {
  // Collect HWNDs from all known Electron windows (overlay, input, pointer, etc.)
  const windows = [overlayWindow, inputWindow, pointerWindow, projectsWindow, conversationPickerWindow, modelPickerWindow];

  // Also include the hidden AI browser window(s) from hiddenBrowserManager
  try {
    const browserWindows = hiddenBrowserManager.getAllWindows ? hiddenBrowserManager.getAllWindows() : [];
    for (const bw of browserWindows) {
      if (bw && !bw.isDestroyed()) windows.push(bw);
    }
  } catch (e) { /* ignore */ }

  // Also include ALL Electron BrowserWindows as safety net
  try {
    const allElectronWindows = BrowserWindow.getAllWindows();
    for (const ew of allElectronWindows) {
      if (ew && !ew.isDestroyed() && !windows.includes(ew)) windows.push(ew);
    }
  } catch (e) { /* ignore */ }

  const hwnds = [];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      try {
        const buf = win.getNativeWindowHandle();
        let hwnd;
        if (buf.length >= 8) {
          hwnd = Number(buf.readBigUInt64LE(0));
        } else {
          hwnd = buf.readUInt32LE(0);
        }
        if (hwnd) hwnds.push(hwnd);
      } catch (e) {
        // ignore
      }
    }
  }
  return hwnds;
}


// ── Agent lifecycle: delegated to task-handler.js ─────────────────────────
// Thin wrappers kept for backward-compatibility with existing call sites.
function launchAgent(task) {
  const result = taskHandler.launch(task);
  agentRunning = taskHandler.isRunning;
  return result;
}

function stopAgent() {
  const result = taskHandler.stop();
  agentRunning = taskHandler.isRunning;
  agentProcess = null;
  return result;
}

// Keep agentRunning in sync when taskHandler finishes on its own.
taskHandler.on('finished', () => {
  agentRunning = false;
  agentProcess = null;
});

// ============================================================
// AUTO-LAUNCH PYTHON TRAY APP
// ============================================================
function launchPythonTrayApp() {
  const pythonExe = path.join('D:\\PENDRIVE\\clicky\\python\\.venv\\Scripts\\python.exe');
  const wrapperScript = path.join('D:\\PENDRIVE\\clicky\\python\\run_client_wrapper.py');
  const cwd = 'D:\\PENDRIVE\\clicky\\python';

  if (!fs.existsSync(pythonExe)) {
    console.warn('[Startup] Python venv not found. Skipping Python tray app launch.');
    return null;
  }

  if (!fs.existsSync(wrapperScript)) {
    console.warn('[Startup] Python wrapper script not found. Skipping Python tray app launch.');
    return null;
  }

  console.log('[Startup] Auto-launching Python tray app...');

  pythonTrayProcess = spawn(pythonExe, ['-u', wrapperScript], {
    cwd: cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  pythonTrayProcess.stdout.on('data', (data) => {
    console.log(`[Python-Tray] ${data.toString().trim()}`);
  });

  pythonTrayProcess.stderr.on('data', (data) => {
    console.error(`[Python-Tray] ${data.toString().trim()}`);
  });

  pythonTrayProcess.on('close', (code) => {
    console.log(`[Python-Tray] Process exited with code ${code}`);
    pythonTrayProcess = null;
  });

  return pythonTrayProcess;
}

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
    { label: 'Re-Login', click: () => { runConnectionCheckpoints(); } },
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

function createModelPicker() {
  console.log('[Startup] Creating Model Picker window...');
  modelPickerWindow = new BrowserWindow({
    width: 440,
    height: 480,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  modelPickerWindow.setAlwaysOnTop(true, 'screen-saver');
  modelPickerWindow.loadFile(path.join(__dirname, '../models/models.html'));

  modelPickerWindow.on('blur', () => {
    if (modelPickerWindow) modelPickerWindow.hide();
  });

  modelPickerWindow.on('closed', () => {
    modelPickerWindow = null;
  });
}

function createPointerWindow() {
  console.log('[Startup] Creating Pointer Overlay window...');
  pointerWindow = new BrowserWindow({
    width: 250,
    height: 90,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  pointerWindow.setIgnoreMouseEvents(true);
  pointerWindow.setAlwaysOnTop(true, 'screen-saver');

  const pointerPath = path.join(__dirname, '../overlay/pointer.html');
  pointerWindow.loadFile(pointerPath);

  pointerWindow.on('closed', () => {
    pointerWindow = null;
  });
}

// ============================================================
// 3-CHECKPOINT CONNECTION FLOW
// ============================================================

async function runConnectionCheckpoints() {
  const provider = 'chatgpt';

  console.log('');
  console.log('[Connection] ================================================');
  console.log(`[Connection] Starting 3-checkpoint verification for: ${provider}`);
  console.log('[Connection] ================================================');

  // ---- CHECKPOINT 1: Reach AI Model ----
  console.log('[Connection] CHECKPOINT 1: Reaching AI model...');
  let win;
  try {
    win = await hiddenBrowserManager.ensureWindow(provider);
    console.log('[Connection] ✓ CHECKPOINT 1 PASSED: Hidden browser created');
    
    await sleep(5000);

    const currentUrl = win.webContents.getURL();
    const pageTitle = win.webContents.getTitle();
    console.log(`[Connection] ✓ CHECKPOINT 1 COMPLETE: Page loaded at ${currentUrl}`);
    console.log(`[Connection]   Page title: "${pageTitle}"`);

  } catch (error) {
    console.error('[Connection] ✗ CHECKPOINT 1 FAILED:', error.message);
    console.error('[Connection] Cannot reach AI model. Check your internet connection.');
    console.log('[Connection] 💡 TIP: Look at the DEBUG browser window to see what happened!');
    console.log('[Connection] ================================================');
    return false;
  }

  // ---- CHECKPOINT 2: Authentication ----
  console.log('[Connection] CHECKPOINT 2: Checking authentication...');
  
  await sleep(2000);
  
  let isAuth = await sessionManager.checkAuthStatus(provider, win.webContents);
  console.log(`[Connection] Auth check result: ${isAuth}`);

  if (!isAuth) {
    console.log('[Connection] ⚠ User is NOT logged in.');
    console.log('[Connection] Opening browser window for manual login...');

    hiddenBrowserManager.showForLogin(provider);

    isAuth = await waitForLogin(provider, win);

    if (isAuth) {
      console.log('[Connection] ✓ CHECKPOINT 2 PASSED: User logged in successfully!');
      hiddenBrowserManager.hideAfterLogin(provider);
      await sleep(3000);
    } else {
      console.error('[Connection] ✗ CHECKPOINT 2 FAILED: Login was not completed within timeout.');
      console.log('[Connection] 💡 TIP: You can try again from the tray menu → Re-Login');
      console.log('[Connection] ================================================');
      return false;
    }
  } else {
    console.log('[Connection] ✓ CHECKPOINT 2 PASSED: User is already logged in!');
  }

  // ---- CHECKPOINT 3: Send test message and display response ----
  console.log('[Connection] CHECKPOINT 3: Sending test message "hi"...');

  try {
    const fullResponse = await sendTestMessage(provider, 'hi');

    console.log('[Connection] ✓ CHECKPOINT 3 PASSED: Response received!');
    console.log('[Connection] ------------------------------------------------');
    console.log('[Connection] AI Response:');
    console.log(fullResponse);
    console.log('[Connection] ------------------------------------------------');

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      // overlayWindow.show();
      stateManager.set('overlayVisibility', true);
      overlayWindow.webContents.send('stream-end', { fullText: fullResponse });
    }

    console.log('[Connection] ✓ Response displayed in overlay window.');

  } catch (error) {
    console.error('[Connection] ✗ CHECKPOINT 3 FAILED:', error.message);
    console.log('[Connection] Could not send/receive test message.');
    console.log('[Connection] 💡 The pipeline is still set up — shortcuts should work once the page is ready.');
    console.log('[Connection] ================================================');
    return false;
  }

  console.log('[Connection] ================================================');
  console.log('[Connection] ✓✓✓ ALL 3 CHECKPOINTS PASSED ✓✓✓');
  console.log('[Connection] The AI Copilot is fully connected and ready.');
  console.log('[Connection] ================================================');
  console.log('');
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

function sendTestMessage(provider, message, imageBase64 = null) {
  return new Promise(async (resolve, reject) => {
    // 600s (10 min): research-heavy providers (e.g. Kimi extracting a large exam
    // paper) can run for many minutes. The gateway's HTTP client waits up to 12
    // minutes, so this 10-minute cap stays comfortably inside it.
    const TEST_MSG_TIMEOUT_MS = 600000;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Test message timed out after 600 seconds'));
    }, TEST_MSG_TIMEOUT_MS);

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
      if (imageBase64) {
        await browserController.injectImageAndSubmit(provider, message, imageBase64);
      } else {
        await browserController.injectAndSubmit(provider, message);
      }
      console.log('[Connection] Test message injected and submitted.');
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

  // ── Provider-switch / context-handoff state (closure-scoped) ──────────
  let switchInProgress = false;   // hold user prompts while switching
  let handoffInProgress = false;  // the seed message priming the new model
  let handoffPayload = null;      // { seed, image_base64, image_meta }
  let pendingQuestion = null;     // a prompt the user fired mid-switch
  let onHandoffDone = null;       // resolver for the seed's stream completion
  let handoffTimer = null;        // safety timeout for the seed

  function providerLabel(p) {
    return (p || '').charAt(0).toUpperCase() + (p || '').slice(1);
  }
  function cleanAssistantText(t) {
    return String(t || '').replace(/\[POINT:[^\]]*\]/gi, '').trim();
  }
  function finishHandoff() {
    handoffInProgress = false;
    handoffPayload = null;
    if (handoffTimer) { clearTimeout(handoffTimer); handoffTimer = null; }
    if (onHandoffDone) { const r = onHandoffDone; onHandoffDone = null; r(); }
  }

  // ── App-side transcript capture (for cross-model context handoff) ─────
  eventBus.on('userQuestionSubmitted', (question) => {
    if (handoffInProgress) return;            // the seed is not a user turn
    if (shouldRouteToAgent(question)) return; // desktop task, not a chat turn
    conversationMemory.addUserTurn(question);
  });
  eventBus.on('streamFinished', ({ fullText } = {}) => {
    if (handoffInProgress) { finishHandoff(); return; } // seed ack — don't record
    if (fullText) conversationMemory.addAssistantTurn(cleanAssistantText(fullText));

    // ── Capture the conversation URL after each response ──────────────────
    // ChatGPT (and other providers) navigate from the base URL to a
    // conversation-specific URL (e.g. /c/<id>) after the first message.
    // We must save this URL so subsequent queries continue in the same
    // conversation thread instead of creating a new one every time.
    try {
      const provider = currentProvider;
      const win = hiddenBrowserManager.getWindow(provider);
      if (win && !win.isDestroyed()) {
        const newUrl = win.webContents.getURL();
        if (stateManager.isConversationUrl(provider, newUrl)) {
          const existingUrl = stateManager.getConstantUrl(provider);
          if (existingUrl !== newUrl) {
            stateManager.setConstantUrl(provider, newUrl);
            console.log(`[Pipeline] Conversation URL captured/updated for ${provider}: ${newUrl}`);
          }
        }
      }
    } catch (e) {
      console.log('[Pipeline] Non-critical: Could not capture conversation URL:', e.message);
    }
  });

  // Handle dynamic provider switching (atomic + guarded + context handoff)
  eventBus.on('providerSwitched', async (newProvider, opts = {}) => {
    console.log(`[Pipeline] Switching AI provider to: ${newProvider}`);

    // 1) Synchronous, atomic flip so any later request targets the new model.
    if (modelPickerWindow && modelPickerWindow.isVisible()) modelPickerWindow.hide();
    eventBus.emit('userRequestCancelled');
    currentProvider = newProvider;
    if (browserProviderInstance.shutdown) browserProviderInstance.shutdown();
    browserProviderInstance = new BrowserProvider(currentProvider);
    switchInProgress = true;
    handoffInProgress = false;
    handoffPayload = null;
    const etaMs = 6000;
    eventBus.emit('showOverlayRequested'); // make the switch timer visible
    eventBus.emit('modelSwitchStarted', { to: providerLabel(newProvider), etaMs });

    try {
      // 2) Bring up the new window and ensure the user is authenticated.
      const win = await hiddenBrowserManager.ensureWindow(currentProvider);
      await sleep(2000);

      const sessionManager = require('../providers/session-manager');
      let isAuth = await sessionManager.checkAuthStatus(currentProvider, win.webContents);
      if (!isAuth) {
        console.log(`[Pipeline] Not logged into ${currentProvider}. Showing login...`);
        hiddenBrowserManager.showForLogin(currentProvider);
        isAuth = await waitForLogin(currentProvider, win);
        if (isAuth) hiddenBrowserManager.hideAfterLogin(currentProvider);
        else console.log(`[Pipeline] Login for ${currentProvider} timed out/failed.`);
      }

      // 3) Hand the whole prior conversation (+ last screenshot) to the new
      //    model so it can continue seamlessly. The seed streams an ack which
      //    we wait for, then declare the model ready.
      if (isAuth && conversationMemory.hasContext()) {
        const sshot = conversationMemory.getLastScreenshot();
        const supportsImg = providerCapabilities.hasCapability(currentProvider, 'supportsImages');
        handoffPayload = {
          seed: conversationMemory.buildHandoffSeed(providerLabel(currentProvider)),
          image_base64: (supportsImg && sshot) ? sshot.dataURL : null,
          image_meta: (supportsImg && sshot) ? sshot.meta : null,
        };
        handoffInProgress = true;
        await new Promise((resolve) => {
          onHandoffDone = resolve;
          handoffTimer = setTimeout(() => finishHandoff(), 30000); // safety net
          eventBus.emit('userQuestionSubmitted', handoffPayload.seed);
        });
      }
    } catch (err) {
      console.error('[Pipeline] Provider switch error:', err.message);
    } finally {
      switchInProgress = false;
      eventBus.emit('modelSwitchReady', { to: providerLabel(currentProvider) });
      console.log('[Pipeline] AI provider switched successfully.');

      // Replay a prompt the user fired during the switch, else (if the switch
      // came from the picker) open the input bar so they can start chatting.
      if (pendingQuestion) {
        const q = pendingQuestion; pendingQuestion = null;
        eventBus.emit('userQuestionSubmitted', q);
      } else if (opts.openInput) {
        eventBus.emit('showInputRequested');
      }
    }
  });

  // ============================================================
  // CORE WIRING: Connect requestStarted → AI prompt injection
  // ============================================================
  eventBus.on('requestStarted', async (question) => {
    try {
      console.log(`[Pipeline] New request received: "${question.substring(0, 60)}..."`);

      // Context handoff: send the pre-built seed straight to the new model so it
      // streams an acknowledgement. Must run BEFORE the switch guard below.
      if (handoffInProgress && handoffPayload) {
        const payload = handoffPayload;
        console.log('[Pipeline] Sending context handoff seed to the new model...');
        try {
          await browserProviderInstance.sendPrompt({
            question: payload.seed,
            image_base64: payload.image_base64 || null,
            image_meta: payload.image_meta || null,
          });
        } catch (e) {
          console.error('[Pipeline] Handoff seed failed:', e.message);
          finishHandoff(); // unblock the switch even if the seed couldn't be sent
        }
        return;
      }

      // While a model switch is in progress, hold the user's prompt and replay
      // it once the new model is ready (block-until-ready behavior).
      if (switchInProgress) {
        pendingQuestion = question;
        console.log('[Pipeline] Switch in progress — holding prompt until the new model is ready.');
        return;
      }

      // If this prompt is a desktop task it goes to the Python agent (handled in
      // the userQuestionSubmitted listener) — don't also run the AI pipeline.
      if (shouldRouteToAgent(question)) {
        console.log('[Pipeline] Skipping AI pipeline — prompt routed to the desktop agent.');
        return;
      }

      // ── Smart routing: chat vs guider ──────────────────────────────────
      const rawQuestion = question;
      const pendingFiles = contextEngine.pendingFiles || [];
      const attachedImage = pendingFiles.find(f => f.kind === 'image' && f.imageBase64) || null;
      const intent = intentRouter.classifyIntent(rawQuestion, {
        hasScreenshot: !!contextEngine.pendingScreenshot,
        hasAttachedImage: !!attachedImage,
      });
      console.log(`[Pipeline] Intent: ${intent.mode} (confidence ${intent.confidence.toFixed(2)}, guide ${intent.guideScore} / chat ${intent.chatScore})`);

      // Guider mode needs a screen to point at. If we have neither a captured
      // screenshot nor an attached image, grab the screen now (UI hidden first).
      if (intent.mode === 'guide' && !contextEngine.pendingScreenshot && !attachedImage) {
        try {
          console.log('[Pipeline] Guide mode without a screenshot — auto-capturing screen...');
          eventBus.emit('hideAllUIRequested');
          await new Promise(resolve => setTimeout(resolve, 500));
          const cap = await captureModule.captureFullScreenDetailed();
          if (cap) {
            contextEngine.setPendingScreenshot(cap.dataURL, { width: cap.width, height: cap.height, displayIndex: cap.displayIndex });
          }
        } catch (capErr) {
          console.warn('[Pipeline] Auto-capture failed:', capErr.message);
        } finally {
          eventBus.emit('showOverlayRequested');
        }
      }

      console.log('[Pipeline] Building context...');
      const contextObject = await contextEngine.buildContext(question);

      // If the user attached an image (and we have no screenshot), route it
      // through the vision path — injectImageAndSubmit takes a single image.
      if (!contextObject.image_base64 && attachedImage) {
        contextObject.image_base64 = attachedImage.imageBase64;
      }

      // Remember the latest screenshot so it can be handed to the next model.
      if (contextObject.image_base64) {
        conversationMemory.setScreenshot(contextObject.image_base64, contextObject.image_meta || null);
      }

      // Pointing is only valid when the image is an actual screen capture whose
      // pixel size we know. Otherwise fall back to a normal chat answer.
      const canPoint = intent.mode === 'guide' && !!contextObject.image_base64 && !!contextObject.image_meta;
      const effectiveMode = canPoint ? 'guide' : 'chat';

      contextObject.question = promptComposer.compose({
        mode: effectiveMode,
        rawQuestion,
        contextObject,
        files: contextObject.attached_files || [],
        image: contextObject.image_meta,
      });

      // Remember the capture dimensions so the pointer handler can map the AI's
      // screenshot-pixel coordinates back to on-screen coordinates (DPI-correct).
      stateManager.set('lastPointImageMeta', canPoint ? contextObject.image_meta : null);
      stateManager.set('currentMode', effectiveMode);
      eventBus.emit('modeSelected', effectiveMode);

      console.log(`[Pipeline] Context built (mode=${effectiveMode}). Sending to AI...`);
      
      const win = hiddenBrowserManager.getWindow(currentProvider);
      if (!win || win.isDestroyed()) {
        throw new Error(`Hidden browser window not available for ${currentProvider}. Please use tray menu → Re-Login.`);
      }
      
      const currentUrl = win.webContents.getURL();
      const capabilities = require('../providers/provider-capabilities');
      const caps = capabilities.getCapabilities(currentProvider);
      if (caps && caps.baseUrl) {
        let isMatch = false;
        if (currentProvider === 'kimi') {
          isMatch = currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('kimi.com');
        } else {
          const domain = new URL(caps.baseUrl).hostname.replace('www.', '');
          isMatch = currentUrl.includes(domain);
        }
        
        if (!isMatch) {
          const provName = currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1);
          throw new Error(`Browser is not on ${provName}. Please log in first via tray menu → Re-Login.`);
        }
      }

      await browserProviderInstance.sendPrompt(contextObject);
      console.log('[Pipeline] Prompt sent to AI successfully.');

      // Fallback completion guard: if the browser never emits a completion event,
      // still close the request after a short wait so the UI doesn't hang forever.
      const fallbackTimer = setTimeout(() => {
        if (stateManager.get('currentRequest')) {
          const currentBuffer = stateManager.get('lastStreamText') || '';
          if (currentBuffer.trim()) {
            console.log('[Pipeline] Fallback completion triggered with buffered text.');
            eventBus.emit('rawStreamFinished', { fullText: currentBuffer });
          } else {
            console.log('[Pipeline] Fallback completion triggered with empty text.');
            eventBus.emit('rawStreamFinished', { fullText: '' });
          }
        }
      }, 15000);

      const finishListener = (data) => {
        clearTimeout(fallbackTimer);
        eventBus.off('rawStreamFinished', finishListener);
      };
      eventBus.on('rawStreamFinished', finishListener);

      // Increment interaction count for the active project
      const activeProject = stateManager.get('currentProject');
      if (activeProject) {
        await projectManager.incrementInteraction(activeProject);
      }

      // Capture conversation URL from the hidden browser after a short delay
      // (project-level tracking — the constant URL for same-conversation threading
      //  is now handled in the streamFinished handler above)
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
              console.log(`[Pipeline] Project conversation ref captured: ${convPath}`);
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
      stateManager.set('currentRequest', null);
      eventBus.emit('streamError', { error: error.message });
      eventBus.emit('requestCancelled', { error: error.message });
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
          const capabilities = require('../providers/provider-capabilities');
          const caps = capabilities.getCapabilities(currentProvider);
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

  createModelPicker();
  console.log('[Startup] Model Picker Created');

  createPointerWindow();
  console.log('[Startup] Pointer Overlay Created');
  
  // Register windows with IPC Manager (4 windows now)
  ipcManager.registerWindows(overlayWindow, inputWindow, null, projectsWindow);
  ipcManager.pointerWebContents = pointerWindow.webContents;
  console.log('[Startup] Windows registered with IPC Manager');

  createTray();
  console.log('[Startup] Tray Created');

  // Initialize TaskHandler with runtime dependencies
  taskHandler.init({
    getOverlayWindow: () => overlayWindow,
    getWindowHwnds: getWindowHwnds,
    pythonExe: path.join('D:\\PENDRIVE\\clicky\\python\\.venv\\Scripts\\python.exe'),
    // Agent brain now lives in the clicky package (guider_client.agent); run_agent.py
    // is a thin launcher whose dirname (clicky/python) becomes cwd so the package imports.
    agentScript: path.join('D:\\PENDRIVE\\clicky\\python\\run_agent.py'),
  });
  console.log('[Startup] TaskHandler Initialized');

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
    if (modelPickerWindow && modelPickerWindow.isVisible()) modelPickerWindow.hide();
    if (pointerWindow && pointerWindow.isVisible()) pointerWindow.hide();
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

  // ── Model picker (Ctrl+Shift+M) ───────────────────────────────────────
  eventBus.on('toggleModelPickerRequested', () => {
    console.log('[Event] toggleModelPickerRequested');
    if (!modelPickerWindow) return;
    if (modelPickerWindow.isVisible()) {
      modelPickerWindow.hide();
    } else {
      // Center the picker on the display under the cursor.
      try {
        const { screen } = require('electron');
        const cursor = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        const b = display.workArea;
        const [w, h] = modelPickerWindow.getSize();
        modelPickerWindow.setPosition(
          Math.round(b.x + (b.width - w) / 2),
          Math.round(b.y + (b.height - h) / 2)
        );
      } catch (_) { /* fall back to last position */ }
      modelPickerWindow.show();
      modelPickerWindow.focus();
      modelPickerWindow.webContents.reload(); // refresh model/login state
    }
  });

  // Resize the input bar taller when file chips need to be shown, else default.
  function sizeInputWindow(files) {
    if (!inputWindow) return;
    const hasFiles = Array.isArray(files) && files.length > 0;
    inputWindow.setSize(560, hasFiles ? 132 : 72);
  }

  eventBus.on('showInputRequested', () => {
    console.log('[Event] showInputRequested');
    if (inputWindow) {
      sizeInputWindow(null);
      inputWindow.show();
      inputWindow.webContents.send('show-input', { prefill: '', hasScreenshot: false, files: [] });
      console.log('[Input] Window shown');
    } else {
      console.warn('[Input] Window is null!');
    }
  });

  eventBus.on('showInputWithScreenshot', (data) => {
    console.log('[Event] showInputWithScreenshot');
    if (inputWindow) {
      const files = data.files || [];
      sizeInputWindow(files);
      inputWindow.show();
      inputWindow.webContents.send('show-input', {
        prefill: data.prefill || '',
        hasScreenshot: data.hasScreenshot || false,
        files
      });
      console.log('[Input] Window shown with screenshot context');
    } else {
      console.warn('[Input] Window is null!');
    }
  });

  // ── Attach files shortcut (Ctrl+Shift+F) ──────────────────────────────
  eventBus.on('attachFilesRequested', async () => {
    console.log('[Event] attachFilesRequested');
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({
        title: 'Attach files for the AI',
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        console.log('[Attach] Cancelled or no files chosen.');
        return;
      }
      const files = await fileAttachment.parseFiles(result.filePaths);
      contextEngine.setPendingFiles(files);
      const summary = files.map(f => ({ name: f.name, kind: f.kind, truncated: f.truncated }));
      eventBus.emit('showInputWithScreenshot', { prefill: '', hasScreenshot: false, files: summary });
    } catch (err) {
      console.error('[Attach] Failed to attach files:', err.message);
    }
  });

  eventBus.on('userQuestionSubmitted', (question) => {
    console.log('[Event] userQuestionSubmitted:', question.substring(0, 50) + '...');

    // ── TASK vs QUESTION classification ──
    // (intent-aware: a clear chat/guide prompt never hijacks to the desktop agent)
    if (shouldRouteToAgent(question)) {
      console.log('[Event] Classified as TASK \u2192 launching agent...');
      const launched = launchAgent(question);
      if (launched) {
        // Show agent status in overlay
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.show();
          stateManager.set('overlayVisibility', true);
        }
      } else {
        // Agent already running or failed to launch
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('stream-error', {
            error: taskHandler.isRunning
              ? 'An agent task is already running. Stop it first or wait for it to finish.'
              : 'Failed to launch agent. Check Python environment.'
          });
        }
      }
    } else {
      console.log('[Event] Classified as QUESTION \u2192 normal AI pipeline');
      // Normal pipeline continues via request-manager.js
    }
  });

  // ── Agent stop request from overlay ──
  eventBus.on('stopAgentRequested', () => {
    console.log('[Event] stopAgentRequested');
    const stopped = stopAgent();
    if (stopped && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('agent-finished', { type: 'agent_stopped' });
    }
  });

  let pointerHideTimeout = null;

  eventBus.on('triggerPointerRequested', (data) => {
    console.log('[Main] triggerPointerRequested received:', data);
    let x = data.x;
    let y = data.y;
    if (data.coordinate && Array.isArray(data.coordinate)) {
      x = data.coordinate[0];
      y = data.coordinate[1];
    }
    const { label } = data;
    let { screenNum } = data;

    const { screen } = require('electron');
    const displays = screen.getAllDisplays();

    // Metadata of the screenshot the AI pointed on (set when a guide request was
    // composed). Used to default the display and to rescale coords if the
    // captured image size differs from the display's logical bounds (DPI safety).
    const imageMeta = stateManager.get('lastPointImageMeta');
    if ((screenNum === null || screenNum === undefined) && imageMeta && typeof imageMeta.displayIndex === 'number') {
      screenNum = imageMeta.displayIndex + 1; // land on the captured monitor, not the cursor's
    }

    // 1. Determine which display to use
    let targetDisplay = null;
    if (screenNum !== null && screenNum !== undefined) {
      const idx = parseInt(screenNum, 10) - 1;
      if (idx >= 0 && idx < displays.length) {
        targetDisplay = displays[idx];
      }
    }

    if (!targetDisplay) {
      const cursorPoint = screen.getCursorScreenPoint();
      targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
    }

    if (!targetDisplay) {
      console.warn('[Pointer] No target display found.');
      return;
    }

    const bounds = targetDisplay.bounds;
    // Rescale the AI's screenshot-pixel coords to the display's logical bounds.
    // When the capture size matches the bounds (the common 100%-scale case) these
    // factors are 1.0 — at other DPIs they correct pointer drift.
    let sx = 1, sy = 1;
    if (imageMeta && imageMeta.width && imageMeta.height) {
      sx = bounds.width / imageMeta.width;
      sy = bounds.height / imageMeta.height;
    }
    let globalX = bounds.x + x * sx;
    let globalY = bounds.y + y * sy;

    if (label && label.trim()) {
      try {
        const { execFileSync } = require('child_process');
        const pythonExe = 'D:\\PENDRIVE\\clicky\\python\\.venv\\Scripts\\python.exe';
        
        const pyCode = `
import sys, ctypes, re
try:
    import comtypes.client
    comtypes.client.GetModule("UIAutomationCore.dll")
    import comtypes.gen.UIAutomationClient as UIA
    uia = comtypes.client.CreateObject(UIA.CUIAutomation)
    root = uia.GetRootElement()
    containers = []
    
    # Active Window
    active_hwnd = ctypes.windll.user32.GetForegroundWindow()
    if active_hwnd:
        try:
            active_element = uia.ElementFromHandle(active_hwnd)
            if active_element: containers.append(active_element)
        except: pass

    # Taskbar
    try:
        hwnd_tb = ctypes.windll.user32.FindWindowW("Shell_TrayWnd", None)
        if hwnd_tb:
            taskbar = uia.ElementFromHandle(hwnd_tb)
            if taskbar: containers.append(taskbar)
    except: pass
    
    # Secondary Taskbars
    try:
        hwnd_sec = 0
        while True:
            hwnd_sec = ctypes.windll.user32.FindWindowExW(0, hwnd_sec, "Shell_SecondaryTrayWnd", None)
            if not hwnd_sec: break
            sec_taskbar = uia.ElementFromHandle(hwnd_sec)
            if sec_taskbar: containers.append(sec_taskbar)
    except: pass
        
    # Progman / WorkerW
    try:
        hwnd_prog = ctypes.windll.user32.FindWindowW("Progman", None)
        if hwnd_prog:
            progman = uia.ElementFromHandle(hwnd_prog)
            if progman: containers.append(progman)
    except: pass
    
    try:
        hwnd_work = 0
        while True:
            hwnd_work = ctypes.windll.user32.FindWindowExW(0, hwnd_work, "WorkerW", None)
            if not hwnd_work: break
            workerw = uia.ElementFromHandle(hwnd_work)
            if workerw: containers.append(workerw)
    except: pass
        
    # Try exact match first
    target = sys.argv[1]
    cond = uia.CreatePropertyCondition(UIA.UIA_NamePropertyId, target)
    for c in containers:
        el = c.FindFirst(UIA.TreeScope_Descendants, cond)
        if el:
            r = el.CurrentBoundingRectangle
            print(f"{(r.left+r.right)//2},{(r.top+r.bottom)//2}")
            sys.exit(0)
            
    # Try fuzzy match
    ALIASES = {
        "folder": "file explorer", "files": "file explorer", "explorer": "file explorer",
        "browser": "google chrome", "chrome": "google chrome", "edge": "microsoft edge",
        "store": "microsoft store", "start": "start", "windows": "start", "search": "search",
        "this pc": "this pc", "my computer": "this pc"
    }
    def norm(t):
        return " ".join([w for w in re.sub(r'[^\\w\\s]', '', t.lower()).split() if w not in ["icon", "button", "tab", "pinned", "pin"]])
    
    best_el, best_score = None, 0
    t_norm = norm(target)
    
    for c in containers:
        elements = c.FindAll(UIA.TreeScope_Descendants, uia.CreateTrueCondition())
        for i in range(elements.Length):
            el = elements.GetElement(i)
            name = el.CurrentName
            if not name or len(name.strip()) < 2: continue
            score = 0
            n_name = name.lower().strip()
            if n_name == target.lower().strip(): score = 100
            else:
                el_norm = norm(name)
                if el_norm and t_norm:
                    if el_norm == t_norm: score = 90
                    elif el_norm in t_norm or t_norm in el_norm: score = 80
                if n_name in target.lower() or target.lower() in n_name: score = 70
                for alias, std in ALIASES.items():
                    if alias in target.lower() and (std in el_norm or el_norm in std):
                        score = 60
            if score > best_score:
                best_score = score
                best_el = el
                if score >= 90: break
        if best_score >= 90: break
        
    if best_el and best_score >= 60:
        r = best_el.CurrentBoundingRectangle
        print(f"{(r.left+r.right)//2},{(r.top+r.bottom)//2}")
        sys.exit(0)
except Exception as e:
    pass
sys.exit(1)
`;
        const output = execFileSync(pythonExe, ['-c', pyCode, label], { encoding: 'utf8', timeout: 3500 });
        if (output && output.trim()) {
          const parts = output.trim().split(',');
          if (parts.length === 2) {
            const px = parseInt(parts[0], 10);
            const py = parseInt(parts[1], 10);
            if (!isNaN(px) && !isNaN(py)) {
              console.log(`[Pointer-Correction] Corrected label "${label}" from (${globalX}, ${globalY}) to actual screen coordinate (${px}, ${py})`);
              globalX = px;
              globalY = py;
            }
          }
        }
      } catch (err) {
        console.warn('[Pointer-Correction] Dynamic correction skipped:', err.message);
      }
    }

    const windowWidth = 250;
    const windowHeight = 90;

    const popupX = Math.max(bounds.x, Math.min(globalX - 20, bounds.x + bounds.width - windowWidth));
    const popupY = Math.max(bounds.y, Math.min(globalY - 6, bounds.y + bounds.height - windowHeight));

    const tipX = globalX - popupX;
    const tipY = globalY - popupY;

    if (pointerWindow && !pointerWindow.isDestroyed()) {
      pointerWindow.setBounds({
        x: Math.round(popupX),
        y: Math.round(popupY),
        width: windowWidth,
        height: windowHeight
      });

      pointerWindow.showInactive();

      pointerWindow.webContents.send('draw-pointer', {
        coordinate: [tipX, tipY],
        label: label || 'right here'
      });

      if (pointerHideTimeout) {
        clearTimeout(pointerHideTimeout);
      }

      pointerHideTimeout = setTimeout(() => {
        if (pointerWindow && !pointerWindow.isDestroyed()) {
          pointerWindow.hide();
        }
      }, 1800);
    }
  });

  eventBus.on('toggleCursorRequested', (hide) => {
    console.log('[Main] toggleCursorRequested received:', hide);
    try {
      const dgram = require('dgram');
      const client = dgram.createSocket('udp4');
      const message = Buffer.from(JSON.stringify({ type: 'toggle_cursor', visible: !hide }));
      client.send(message, 9877, '127.0.0.1', (err) => {
        if (err) console.error('[Main] Failed to send UDP toggle_cursor:', err);
        client.close();
      });
    } catch (err) {
      console.error('[Main] Error creating UDP socket for toggle_cursor:', err);
    }
  });

  console.log('[Startup] ========================================');
  console.log('[Startup] All UI systems initialized!');
  console.log('[Startup] ========================================');
  console.log('[Startup] Now running AI connection checkpoints...');
  console.log('');

  // Setup the AI pipeline first so shortcuts and UI listeners are fully responsive immediately
  setupAIPipeline();

  // Auto-launch Python tray app (mascot + voice)
  launchPythonTrayApp();
  console.log('[Startup] Python tray app launch initiated');

  // Start polling Supabase for remote queries (PC B to PC A bridge)
  // startSupabasePollingLoop();

  // Run the 3-checkpoint connection flow asynchronously in the background
  runConnectionCheckpoints().then(checkpointsPassed => {
    if (!checkpointsPassed) {
      console.log('[Startup] ⚠ Checkpoints did not fully pass.');
      console.log('[Startup] The pipeline is ready — once you log in, shortcuts will work.');
      console.log('[Startup] Use tray menu → Re-Login to try again.');
    }
  }).catch(err => {
    console.error('[Startup] Checkpoints encountered an error:', err.message);
  });

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
  if (voiceHelperProcess) {
    console.log('[Shutdown] Terminating Voice Helper process...');
    voiceHelperProcess.kill();
  }
  if (pythonTrayProcess) {
    console.log('[Shutdown] Terminating Python tray app...');
    pythonTrayProcess.kill();
  }
  if (taskHandler.isRunning) {
    console.log('[Shutdown] Terminating agent process...');
    taskHandler.stop();
  }
  console.log('[Shutdown] Shortcuts unregistered. Context detector stopped. Goodbye.');
});

// ============================================================
// DEBUG: HTTP trigger for automated testing
// Allows triggering shortcut events via: curl http://localhost:9876/trigger?event=screenshot
// Remove this block for production builds.
// ============================================================
const http = require('http');
const captureModule = require('./capture');



const mapModelToProvider = (modelName) => {
  const name = (modelName || '').toLowerCase();
  if (name.includes('gemini')) {
    return 'gemini';
  }
  // Google Search AI Mode (SGE) is a distinct provider from Gemini.
  if (name.includes('google')) {
    return 'google';
  }
  if (name.includes('chatgpt') || name.includes('gpt') || name.includes('openai')) {
    return 'chatgpt';
  }
  if (name.includes('kimi')) {
    return 'kimi';
  }
  if (name.includes('claude')) {
    return 'claude';
  }
  if (name.includes('deepseek')) {
    return 'deepseek';
  }
  if (name.includes('perplexity')) {
    return 'perplexity';
  }
  return stateManager.get('currentProvider') || 'chatgpt';
};

// ── Browser serialization queue ───────────────────────────────────────────
// The browser automation drives ONE window per provider and can only handle a
// single prompt at a time. When the app is exposed to many website users via the
// gateway, concurrent requests would collide (interleaved injections, provider
// switches). This mutex serializes all chat-completions so each request gets the
// browser to itself; others wait their turn. A depth guard sheds load past a cap.
let __chatBusy = false;
const __chatWaiters = [];
const MAX_CHAT_QUEUE = 8;
function acquireChatLock() {
  return new Promise((resolve) => {
    if (!__chatBusy) { __chatBusy = true; resolve(); }
    else __chatWaiters.push(resolve);
  });
}
function releaseChatLock() {
  const next = __chatWaiters.shift();
  if (next) next();            // hand the lock straight to the next waiter
  else __chatBusy = false;
}

// Render a full OpenAI-style messages[] history into a single self-contained
// prompt. Used for gateway/web requests so each turn is stateless and isolated:
// the model sees only this user's conversation (injected into a fresh chat),
// never another user's thread.
function contentOf(m) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content.filter(p => p && p.type === 'text').map(p => p.text).join(' ');
  }
  return '';
}
function flattenMessages(messages) {
  const cleaned = [];
  for (const m of messages) {
    const text = contentOf(m).trim();
    if (!text) continue;
    // Drop consecutive duplicates (the gateway may echo the current user msg).
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === m.role && prev.text === text) continue;
    cleaned.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text });
  }
  // Anti-leak framing: all web users share ONE provider account whose cross-chat
  // "memory" would otherwise bleed one user's facts into another's. Instruct the
  // model to answer ONLY from the conversation supplied here.
  const guard = 'Treat this as a fresh, standalone request from a brand-new user. Ignore any saved memory, personalization, or details from previous or other conversations — they are not relevant here.';
  if (cleaned.length <= 1) {
    const only = cleaned.length ? cleaned[0].text : '';
    return only ? `${guard}\n\nUser: ${only}` : only;
  }
  const last = cleaned[cleaned.length - 1];
  const history = cleaned.slice(0, -1)
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.text}`)
    .join('\n');
  return `${guard}\n\nConversation so far:\n${history}\n\nUser: ${last.text}\n\nReply only to the latest User message.`;
}

// Force a brand-new chat thread for the given provider by navigating its hidden
// window to the provider's base URL. Guarantees per-user isolation: a web request
// never lands in a thread that holds another user's messages.
async function startFreshChat(provider) {
  try {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win || win.isDestroyed()) return;
    const caps = require('../providers/provider-capabilities').getCapabilities(provider);
    if (!caps || !caps.baseUrl) return;
    const selectors = require('../providers/selector-manager').getSelectors(provider);
    stateManager.setConstantUrl(provider, null);
    await win.loadURL(caps.baseUrl);
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', resolve);
      setTimeout(resolve, 12000);
    });
    // Wait until the prompt input is actually present+interactive before returning,
    // so the subsequent injection doesn't race an un-rendered SPA (which silently
    // drops the message). Poll up to ~12s.
    const inputSel = (selectors.textarea || '').replace(/'/g, "\\'");
    for (let i = 0; i < 24; i++) {
      const ready = await win.webContents.executeJavaScript(`(() => {
        try {
          const el = document.querySelector('${inputSel}')
            || document.querySelector('#prompt-textarea')
            || document.querySelector('[contenteditable="true"]')
            || document.querySelector('textarea');
          return !!el && el.offsetParent !== null;
        } catch (e) { return false; }
      })()`).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    await sleep(800);
  } catch (e) {
    console.error('[Proxy] startFreshChat failed:', e.message);
  }
}

const debugServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:9876');
  const action = url.pathname;

  res.setHeader('Content-Type', 'application/json');

  // --- API Key Authentication ---
  const providedKey = url.searchParams.get('api_key') || req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  const expectedKey = stateManager.get('apiKey');

  const isChatCompletions = action === '/v1/chat/completions' || action === '/chat/completions';
  const isVoiceEndpoint = action.startsWith('/voice/');

  const isLocalhost = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1';

  if (!isChatCompletions && !isVoiceEndpoint && !isLocalhost && providedKey !== expectedKey) {
    console.warn(`[DEBUG-HTTP] Unauthorized API access attempt. Key provided: ${providedKey ? '***' : 'none'}`);
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing API Key.' }));
  }
  // ------------------------------

  try {
    if (isChatCompletions && req.method === 'POST') {
      // Only hide windows if agent is NOT running
      // When agent is running, WDA_EXCLUDEFROMCAPTURE handles screenshot exclusion
      if (!taskHandler.isRunning) {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.hide();
          stateManager.set('overlayVisibility', false);
        }
        if (inputWindow && !inputWindow.isDestroyed()) {
          inputWindow.hide();
        }
        if (pointerWindow && !pointerWindow.isDestroyed()) {
          pointerWindow.hide();
        }
      }
      // Hide the browser window if it's visible (always hide this)
      try {
        const chatgptWin = hiddenBrowserManager.getWindow('chatgpt');
        if (chatgptWin && !chatgptWin.isDestroyed()) {
          chatgptWin.hide();
        }
      } catch (e) {
        console.error('[Proxy] Failed to hide browser window:', e.message);
      }

      let bodyStr = '';
      for await (const chunk of req) {
        bodyStr += chunk;
      }
      
      let body = {};
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
      
      const messages = body.messages || [];
      let userMessage = '';
      let imageBase64 = null;
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        if (typeof lastMessage.content === 'string') {
          userMessage = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
          for (const part of lastMessage.content) {
            if (part.type === 'text') {
              userMessage = part.text;
            } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
              imageBase64 = part.image_url.url;
            }
          }
        }
      }
      
      if (!userMessage) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'No user message found' }));
      }

      // Multi-user / gateway requests carry a conversation_id. Treat these as
      // stateless, isolated web turns: flatten the full history into one prompt
      // and start a fresh chat so no two users share a browser thread.
      const isWebRequest = !!body.conversation_id;
      if (isWebRequest && !imageBase64) {
        userMessage = flattenMessages(messages) || userMessage;
      }

      // Serialize browser access (the automation is single-flight). Shed load if
      // too many requests are already queued so callers get a clear signal.
      if (__chatWaiters.length >= MAX_CHAT_QUEUE) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: 'Assistant is busy handling other requests. Please retry in a moment.' }));
      }
      await acquireChatLock();
      let __lockReleased = false;
      const __releaseLock = () => { if (!__lockReleased) { __lockReleased = true; releaseChatLock(); } };
      // Release the browser once this response completes (finish or client disconnect).
      res.once('close', __releaseLock);

      const model = body.model || 'mini-perplexity';
      const targetProvider = mapModelToProvider(model);
      console.log(`[DEBUG-HTTP] Proxying chat request to browser provider: ${targetProvider} (requested model: ${model})${isWebRequest ? ' [web conv=' + body.conversation_id + ']' : ''}`);

      const oldProvider = stateManager.get('currentProvider');
      if (oldProvider !== targetProvider) {
        console.log(`[Proxy] Target provider (${targetProvider}) differs from current provider (${oldProvider}). Triggering provider switch.`);
        stateManager.set('currentProvider', targetProvider);
        eventBus.emit('providerSwitched', targetProvider);
        // Wait a brief moment for switching and load to settle
        await sleep(3000);
      } else {
        // Ensure the window for targetProvider is initialized and loaded
        await hiddenBrowserManager.ensureWindow(targetProvider);
      }

      // For isolated web turns, always begin a fresh chat so this user's context
      // (re-sent in full above) is the ONLY thing the model sees.
      if (isWebRequest) {
        await startFreshChat(targetProvider);
      }

      if (body.stream === true) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const crypto = require('crypto');
        const runId = 'chatcmpl-' + crypto.randomUUID();

        let lastText = '';

        function getIncrementalChunk(oldText, newText) {
          if (!newText) return '';
          if (!oldText) return newText;
          if (newText.startsWith(oldText)) {
            return newText.substring(oldText.length);
          }
          let i = 0;
          while (i < oldText.length && i < newText.length && oldText[i] === newText[i]) {
            i++;
          }
          return newText.substring(i);
        }

        const onChunk = (event, chunk) => {
          if (typeof chunk !== 'string') return;
          lastText += chunk;
          const chunkData = {
            id: runId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                delta: {
                  content: chunk
                },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
        };

        const onSync = (event, fullText) => {
          if (typeof fullText !== 'string') return;
          const chunk = getIncrementalChunk(lastText, fullText);
          if (chunk) {
            lastText = fullText;
            
            const chunkData = {
              id: runId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: chunk
                  },
                  finish_reason: null
                }
              ]
            };
            res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
          }
        };

        const onComplete = (event, data) => {
          cleanup();

          const win = hiddenBrowserManager.getWindow(targetProvider);
          if (win) {
            const finalUrl = win.webContents.getURL();
            if (stateManager.isConversationUrl(targetProvider, finalUrl)) {
              const existingUrl = stateManager.getConstantUrl(targetProvider);
              if (existingUrl !== finalUrl) {
                stateManager.setConstantUrl(targetProvider, finalUrl);
                console.log(`[Proxy] Conversation URL captured/updated for ${targetProvider}: ${finalUrl}`);
              }
            }
          }
          
          if (data && typeof data.fullText === 'string') {
            const chunk = getIncrementalChunk(lastText, data.fullText);
            if (chunk) {
              lastText = data.fullText;
              
              const chunkData = {
                id: runId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: chunk
                    },
                    finish_reason: null
                  }
                ]
              };
              res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
            }
          }

          const finalChunk = {
            id: runId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }
            ]
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        };

        const onError = (event, err) => {
          cleanup();
          res.write(`event: error\ndata: ${JSON.stringify({ error: err || 'Stream error' })}\n\n`);
          res.end();
        };

        function cleanup() {
          ipcMain.removeListener('ai-chunk', onChunk);
          ipcMain.removeListener('ai-sync', onSync);
          ipcMain.removeListener('ai-complete', onComplete);
          ipcMain.removeListener('ai-error', onError);
        }

        ipcMain.on('ai-chunk', onChunk);
        ipcMain.on('ai-sync', onSync);
        ipcMain.on('ai-complete', onComplete);
        ipcMain.on('ai-error', onError);

        try {
          const win = hiddenBrowserManager.getWindow(targetProvider);
          if (win) {
            const currentUrl = win.webContents.getURL();
            if (stateManager.isConversationUrl(targetProvider, currentUrl) && !stateManager.getConstantUrl(targetProvider)) {
              stateManager.setConstantUrl(targetProvider, currentUrl);
              console.log(`[Proxy] Automatically locked onto existing conversation URL for ${targetProvider}: ${currentUrl}`);
            }

            const constantUrl = stateManager.getConstantUrl(targetProvider);
            if (constantUrl && currentUrl !== constantUrl) {
              console.log(`[Proxy] Navigating to constant conversation URL for ${targetProvider}: ${constantUrl}`);
              try {
                await win.loadURL(constantUrl);
                await new Promise(resolve => {
                  win.webContents.once('did-finish-load', resolve);
                  win.webContents.once('did-fail-load', resolve);
                  setTimeout(resolve, 6000);
                });
                await sleep(1500);
              } catch (loadErr) {
                console.error(`[Proxy] Failed to load constant URL: ${loadErr.message}`);
              }
            }

            // Check if prompt input elements are present
            const selectors = require('../providers/selector-manager').getSelectors(targetProvider);
            let hasInput = await win.webContents.executeJavaScript(`
              !!(document.querySelector('${selectors.textarea}') || 
                 document.querySelector('#prompt-textarea') || 
                 document.querySelector('[contenteditable="true"]'))
            `).catch(() => false);

            if (!hasInput) {
              console.warn(`[Proxy] No valid prompt input element found on the current page. Recovering to provider base URL...`);
              stateManager.setConstantUrl(targetProvider, null);
              const caps = require('../providers/provider-capabilities').getCapabilities(targetProvider);
              console.log(`[Proxy] Loading base URL: ${caps.baseUrl}`);
              await win.loadURL(caps.baseUrl).catch(err => console.error(`[Proxy] Failed to load base URL: ${err.message}`));
              await new Promise(resolve => {
                win.webContents.once('did-finish-load', resolve);
                win.webContents.once('did-fail-load', resolve);
                setTimeout(resolve, 8000);
              });
              await sleep(2000);
            }
          }

          await browserController.attachStreamObserver(targetProvider);
          await sleep(500);
          if (imageBase64) {
            await browserController.injectImageAndSubmit(targetProvider, userMessage, imageBase64);
          } else {
            await browserController.injectAndSubmit(targetProvider, userMessage);
          }
        } catch (err) {
          cleanup();
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      try {
        const fullResponse = await sendTestMessage(targetProvider, userMessage, imageBase64);
        
        const crypto = require('crypto');
        const openaiResponse = {
          id: 'chatcmpl-' + crypto.randomUUID(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model || 'mini-perplexity',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: fullResponse
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        };
        
        res.end(JSON.stringify(openaiResponse));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (action === '/voice/pressed' && req.method === 'POST') {
      console.log('[HTTP-Server] Voice recording pressed.');
      eventBus.emit('voiceStateChanged', 'listening');
      res.end(JSON.stringify({ ok: true }));
      return;
    } else if (action === '/voice/released' && req.method === 'POST') {
      console.log('[HTTP-Server] Voice recording released.');
      eventBus.emit('voiceStateChanged', 'processing');
      res.end(JSON.stringify({ ok: true }));
      return;
    } else if (action === '/voice/transcribed' && req.method === 'POST') {
      let bodyStr = '';
      for await (const chunk of req) {
        bodyStr += chunk;
      }
      const params = new URLSearchParams(bodyStr);
      const question = params.get('q') || '';
      console.log(`[HTTP-Server] Voice transcription received: "${question}"`);

      if (!question.trim()) {
        console.log('[HTTP-Server] Empty transcript, resetting state.');
        eventBus.emit('voiceStateChanged', 'idle');
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      eventBus.emit('hideAllUIRequested');
      await new Promise(r => setTimeout(r, 500));
      const screenshot = await captureModule.captureFullScreen();
      if (screenshot) {
        contextEngine.setPendingScreenshot(screenshot);
        console.log('[HTTP-Server] Screenshot stored.');
      }
      
      eventBus.emit('userQuestionSubmitted', question);
      res.end(JSON.stringify({ ok: true, question }));
      return;
    }

    if (action === '/screenshot') {
      console.log('[DEBUG-HTTP] Requesting captureFullScreen...');
      try {
        // Hide all Clicky UI so copilot doesn't appear in agent screenshots
        if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) overlayWindow.hide();
        if (inputWindow && !inputWindow.isDestroyed() && inputWindow.isVisible()) inputWindow.hide();
        if (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow.isVisible()) projectsWindow.hide();
        if (conversationPickerWindow && !conversationPickerWindow.isDestroyed() && conversationPickerWindow.isVisible()) conversationPickerWindow.hide();
        if (modelPickerWindow && !modelPickerWindow.isDestroyed() && modelPickerWindow.isVisible()) modelPickerWindow.hide();
        if (pointerWindow && !pointerWindow.isDestroyed() && pointerWindow.isVisible()) pointerWindow.hide();
        await new Promise(r => setTimeout(r, 300));

        const screenshot = await captureModule.captureFullScreen();
        if (screenshot) {
          let b64 = screenshot;
          if (b64.startsWith('data:')) {
            b64 = b64.substring(b64.indexOf(',') + 1);
          }
          res.end(JSON.stringify({ ok: true, screenshot: b64 }));
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Screenshot returned null' }));
        }
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (action === '/screenshot/active-window') {
      console.log('[DEBUG-HTTP] Requesting active-window screenshot...');
      try {
        // Hide all Clicky UI before capture
        if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) overlayWindow.hide();
        if (inputWindow && !inputWindow.isDestroyed() && inputWindow.isVisible()) inputWindow.hide();
        if (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow.isVisible()) projectsWindow.hide();
        if (conversationPickerWindow && !conversationPickerWindow.isDestroyed() && conversationPickerWindow.isVisible()) conversationPickerWindow.hide();
        if (modelPickerWindow && !modelPickerWindow.isDestroyed() && modelPickerWindow.isVisible()) modelPickerWindow.hide();
        if (pointerWindow && !pointerWindow.isDestroyed() && pointerWindow.isVisible()) pointerWindow.hide();
        await new Promise(r => setTimeout(r, 300));

        const cap = await captureModule.captureFullScreenDetailed();
        if (!cap || !cap.dataURL) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: 'Capture failed' }));
        }

        // Get active window bounds from context-detector (fresh poll)
        const activeCtx = contextDetector.pollNow();
        let resultB64 = cap.dataURL;
        let windowInfo = null;

        if (activeCtx && activeCtx.bounds) {
          windowInfo = {
            title: activeCtx.windowTitle,
            process: activeCtx.processName,
            bounds: activeCtx.bounds
          };

          const { screen: electronScreen } = require('electron');
          const displays = electronScreen.getAllDisplays();
          const targetDisplay = displays[cap.displayIndex || 0] || displays[0];
          const localX = activeCtx.bounds.left - targetDisplay.bounds.x;
          const localY = activeCtx.bounds.top - targetDisplay.bounds.y;
          const w = activeCtx.bounds.right - activeCtx.bounds.left;
          const h = activeCtx.bounds.bottom - activeCtx.bounds.top;

          if (w > 10 && h > 10 && localX > -10000 && localY > -10000) {
            try {
              const img = nativeImage.createFromDataURL(cap.dataURL);
              const cropX = Math.max(0, Math.round(localX));
              const cropY = Math.max(0, Math.round(localY));
              const cropW = Math.min(Math.round(w), cap.width - cropX);
              const cropH = Math.min(Math.round(h), cap.height - cropY);

              if (cropW > 10 && cropH > 10) {
                const cropped = img.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
                resultB64 = cropped.toDataURL();
                console.log(`[DEBUG-HTTP] Cropped screenshot to active window: ${cropW}x${cropH} at (${cropX},${cropY})`);
              }
            } catch (cropErr) {
              console.warn('[DEBUG-HTTP] Crop failed, returning full screen:', cropErr.message);
            }
          }
        }

        let b64 = resultB64;
        if (b64.startsWith('data:')) {
          b64 = b64.substring(b64.indexOf(',') + 1);
        }
        res.end(JSON.stringify({ ok: true, screenshot: b64, windowInfo }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

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
          
          // Look for any elements containing "hi" or potential response messages
          const elementsWithText = [];
          document.querySelectorAll('div, p, span, pre, code').forEach(el => {
            const txt = el.textContent.trim();
            if (txt.length > 0 && txt.length < 500) {
              if (txt.toLowerCase() === 'hi' || txt.includes('help') || txt.includes('how can') || txt.includes('hello')) {
                elementsWithText.push({
                  tag: el.tagName,
                  classes: el.className,
                  text: txt.substring(0, 100),
                  parentTag: el.parentElement ? el.parentElement.tagName : null,
                  parentClasses: el.parentElement ? el.parentElement.className : null
                });
              }
            }
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
            composerArea: !!document.querySelector('#prompt-textarea') || !!document.querySelector('[contenteditable="true"]'),
            attachButton: !!document.querySelector('button[aria-label*="ttach"]'),
            elementsWithText: elementsWithText.slice(0, 20)
          };
        })();
      `);
      res.end(JSON.stringify({ ok: true, domInfo }, null, 2));

    } else if (action === '/debug/eval') {
      const code = url.searchParams.get('code');
      console.log(`[DEBUG-HTTP] Eval: ${code}`);
      const result = await eval(code);
      res.end(JSON.stringify({ ok: true, result }));

    // ============================================================
    // AGENT ENDPOINTS
    // ============================================================
    } else if (action === '/agent/run' && req.method === 'POST') {
      let bodyStr = '';
      for await (const chunk of req) {
        bodyStr += chunk;
      }
      let body = {};
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
      const task = body.task || '';
      if (!task.trim()) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'No task provided' }));
      }
      const launched = launchAgent(task);
      res.end(JSON.stringify({ ok: launched, task, agentRunning: taskHandler.isRunning }));

    } else if (action === '/agent/status') {
      res.end(JSON.stringify({ ok: true, agentRunning: taskHandler.isRunning }));

    } else if (action === '/agent/stop' && req.method === 'POST') {
      const stopped = stopAgent();
      res.end(JSON.stringify({ ok: stopped, agentRunning: taskHandler.isRunning }));

    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Unknown action' }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

let voiceHelperProcess = null;

function startVoiceHelper() {
  console.log('[Startup] Starting Voice Helper subprocess...');
  
  const guiderPath = 'D:\\PENDRIVE\\clicky';
  const pythonExe = path.join(guiderPath, 'python\\.venv\\Scripts\\python.exe');
  const voiceHelperScript = path.join(__dirname, 'voice-helper.py');
  const modelDir = path.join(guiderPath, 'python\\vosk-model-small-en-us-0.15');

  if (!fs.existsSync(pythonExe)) {
    console.warn(`[Startup] ⚠ Python virtual env not found at ${pythonExe}. Voice capture will be disabled.`);
    return;
  }

  if (!fs.existsSync(modelDir)) {
    console.warn(`[Startup] ⚠ Vosk model not found at ${modelDir}. Voice capture will be disabled.`);
    return;
  }

  console.log(`[Startup] Launching Voice Helper: "${pythonExe}" "${voiceHelperScript}" --model-dir "${modelDir}"`);

  voiceHelperProcess = spawn(pythonExe, [
    '-u',
    voiceHelperScript,
    '--model-dir', modelDir,
    '--port', '9876'
  ]);

  voiceHelperProcess.stdout.on('data', (data) => {
    console.log(`[Voice Helper] stdout: ${data.toString().trim()}`);
  });

  voiceHelperProcess.stderr.on('data', (data) => {
    console.error(`[Voice Helper] stderr: ${data.toString().trim()}`);
  });

  voiceHelperProcess.on('close', (code) => {
    console.log(`[Voice Helper] process exited with code ${code}`);
    voiceHelperProcess = null;
  });
}

debugServer.listen(9876, '127.0.0.1', () => {
  console.log('[DEBUG] HTTP test server listening on http://127.0.0.1:9876');
  // startVoiceHelper();
});

function startSupabasePollingLoop() {
  const fs = require('fs');
  const crypto = require('crypto');

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

  const mapModelToProvider = (modelName) => {
    const name = (modelName || '').toLowerCase();
    if (name.includes('gemini') || name.includes('google')) {
      return 'gemini';
    }
    if (name.includes('chatgpt') || name.includes('gpt') || name.includes('openai')) {
      return 'chatgpt';
    }
    return stateManager.get('currentProvider') || 'chatgpt';
  };

  const sbUrl = getEnvVar('SUPABASE_URL');
  const sbKey = getEnvVar('SUPABASE_KEY');

  if (!sbUrl || !sbKey) {
    console.log('[SupabasePolling] Supabase credentials missing. Polling loop disabled.');
    return;
  }

  console.log('[SupabasePolling] Starting background polling loop for remote queries...');

  const headers = {
    'apikey': sbKey,
    'Authorization': `Bearer ${sbKey}`,
    'Content-Type': 'application/json'
  };

  setInterval(async () => {
    try {
      // 1. Fetch latest user message for supported models where device_id is null
      const res = await fetch(`${sbUrl}/rest/v1/messages?role=eq.user&device_id=is.null&model=in.(mini-perplexity,chatgpt,gemini,gpt-4,gpt-3.5-turbo,default)&order=created_at.desc&limit=1`, {
        headers
      });

      if (!res.ok) {
        return;
      }

      const results = await res.json();
      if (!results || results.length === 0) {
        return; // No pending messages
      }

      const pendingMsg = results[0];
      
      // Make sure message is not too old (ignore messages older than 5 minutes on startup/idle)
      const msgTime = new Date(pendingMsg.created_at).getTime();
      const nowTime = Date.now();
      if (nowTime - msgTime > 5 * 60 * 1000) {
        // Mark as expired to avoid stuck queue
        await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            device_id: 'expired'
          })
        });
        return;
      }

      console.log(`[SupabasePolling] Found pending user query: "${pendingMsg.content.substring(0, 60)}..."`);

      // 2. Lock the message by setting device_id to 'processing'
      const lockRes = await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
        method: 'PATCH',
        headers: {
          ...headers,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          device_id: 'processing'
        })
      });

      if (!lockRes.ok) {
        console.error('[SupabasePolling] Failed to lock message');
        return;
      }

      // 3. Process query via the hidden browser
      const provider = mapModelToProvider(pendingMsg.model);
      console.log(`[SupabasePolling] Running remote query through provider: ${provider} (requested model: ${pendingMsg.model})`);
      
      // Save a placeholder assistant response to Supabase messages immediately to start streaming
      const startRes = await fetch(`${sbUrl}/rest/v1/messages`, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          conversation_id: pendingMsg.conversation_id,
          role: 'assistant',
          content: '',
          model: provider,
          user_id: 'gateway'
        })
      });

      if (!startRes.ok) {
        const errText = await startRes.text();
        console.error(`[SupabasePolling] Failed to create assistant message placeholder: ${errText}`);
        // Unlock on failure
        await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            device_id: null
          })
        });
        return;
      }

      const assistantMsgRow = (await startRes.json())[0];
      const assistantMsgId = assistantMsgRow.id;

      let fullResponseText = '';
      let lastDbWriteTime = 0;
      let writeTimeout = null;

      const updateSupabaseContent = async (content, isFinal = false) => {
        fullResponseText = content;
        const now = Date.now();
        
        const doWrite = async () => {
          if (writeTimeout) {
            clearTimeout(writeTimeout);
            writeTimeout = null;
          }
          try {
            await fetch(`${sbUrl}/rest/v1/messages?id=eq.${assistantMsgId}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                content: fullResponseText
              })
            });
            lastDbWriteTime = Date.now();
          } catch (e) {
            console.error('[SupabasePolling] Error updating database row:', e.message);
          }
        };

        if (isFinal) {
          await doWrite();
        } else if (now - lastDbWriteTime > 400) {
          await doWrite();
        } else if (!writeTimeout) {
          writeTimeout = setTimeout(doWrite, 400);
        }
      };

      const onChunk = (event, chunk) => {
        updateSupabaseContent(fullResponseText + chunk);
      };

      const completePromise = new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Query timed out after 60 seconds'));
        }, 60000);

        const onComplete = (event, data) => {
          clearTimeout(timeout);
          cleanup();
          const finalVal = (data && data.fullText) ? data.fullText : fullResponseText;
          resolve(finalVal);
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
          await browserController.injectAndSubmit(provider, pendingMsg.content);
        } catch (err) {
          clearTimeout(timeout);
          cleanup();
          reject(err);
        }
      });

      try {
        const finalResponseText = await completePromise;
        await updateSupabaseContent(finalResponseText, true);
      } catch (err) {
        console.error(`[SupabasePolling] Error processing remote query: ${err.message}`);
        // Delete placeholder message on failure
        await fetch(`${sbUrl}/rest/v1/messages?id=eq.${assistantMsgId}`, {
          method: 'DELETE',
          headers
        });
        // Unlock user message
        await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            device_id: null
          })
        });
        return;
      }

      // 4. Update user message to 'completed'
      await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          device_id: 'completed'
        })
      });

      console.log('[SupabasePolling] Successfully completed and saved remote query response.');

    } catch (error) {
      console.error('[SupabasePolling] Error in polling loop:', error.message);
    }
  }, 500); // Poll every 500ms (0.5s) for near real-time response
}
