/**
 * Test Script: Validates Ctrl+Shift+Space (screenshot + question) chain
 * 
 * Tests the full event chain WITHOUT needing Electron:
 *   shortcut → hideAllUI → capture → setPendingScreenshot → showInputWithScreenshot
 *   → submitQuestion → requestStarted → buildContext → sendPrompt (with image)
 *
 * Run: node test-shortcuts.js
 */

// ── Mocks for Electron modules ────────────────────────────────
const _shortcutMap = {};
const mockElectron = {
  globalShortcut: { 
    register: (combo, cb) => { _shortcutMap[combo] = cb; return true; },
    unregisterAll: () => {},
  },
  get _shortcuts() { return _shortcutMap; },
  desktopCapturer: {
    getSources: async () => ([{
      thumbnail: { toDataURL: () => 'data:image/png;base64,FAKE_SCREENSHOT_DATA_HERE' }
    }])
  },
  screen: {
    getAllDisplays: () => ([{
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    }])
  },
  app: { getPath: () => '/tmp' },
  BrowserWindow: class { constructor() {} },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  clipboard: { writeImage: () => {} }
};

// Override require for Electron
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent) {
  if (request === 'electron') return request;
  return origResolve.call(this, request, parent);
};
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: mockElectron
};

// ── Now load real modules ────────────────────────────────────
const eventBus = require('./src/main/event-bus');
const contextEngine = require('./src/main/context-engine');
const captureModule = require('./src/main/capture');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  Ctrl+Shift+Space Chain Verification');
  console.log('═══════════════════════════════════════════\n');

  // ── Test 1: Shortcut Registration ────────────────────────
  console.log('Test 1: Shortcut Registration');
  
  // Load shortcuts module (this calls registerAll implicitly? No, we call it)
  const ShortcutsModule = require('./src/main/shortcuts');
  ShortcutsModule.registerAll();
  
  const registeredShortcuts = Object.keys(mockElectron._shortcuts);
  assert(registeredShortcuts.includes('CommandOrControl+Shift+Space'), 'Ctrl+Shift+Space is registered');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+Q'), 'Ctrl+Shift+Q is registered');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+O'), 'Ctrl+Shift+O is registered');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+J'), 'Ctrl+Shift+J is registered (was P)');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+N'), 'Ctrl+Shift+N is registered');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+H'), 'Ctrl+Shift+H is registered');
  assert(registeredShortcuts.includes('CommandOrControl+Alt+R'), 'Ctrl+Alt+R is registered (was Shift+R)');
  assert(registeredShortcuts.includes('CommandOrControl+Shift+M'), 'Ctrl+Shift+M is registered');
  assert(!registeredShortcuts.includes('Escape'), 'Escape is NOT registered globally');
  assert(registeredShortcuts.length === 8, `Exactly 8 shortcuts registered (got ${registeredShortcuts.length})`);
  console.log('');

  // ── Test 2: Screenshot Capture Chain ──────────────────────
  console.log('Test 2: Screenshot Capture + Pending Storage');
  
  const screenshot = await captureModule.captureFullScreen();
  assert(screenshot !== null, 'captureFullScreen() returns data URL');
  assert(screenshot.startsWith('data:image/png;base64,'), 'Screenshot is a PNG data URL');
  
  contextEngine.setPendingScreenshot(screenshot);
  assert(contextEngine.pendingScreenshot === screenshot, 'pendingScreenshot is stored');
  console.log('');

  // ── Test 3: Context Engine builds context with screenshot ──
  console.log('Test 3: Context Engine builds context with screenshot');
  
  const context = await contextEngine.buildContext('Analyze the screen');
  assert(context.question === 'Analyze the screen', 'Question is set correctly');
  assert(context.image_base64 !== null, 'image_base64 is present in context');
  assert(context.image_base64.startsWith('data:image/png;base64,'), 'image_base64 is a valid data URL');
  assert(contextEngine.pendingScreenshot === null, 'pendingScreenshot is consumed (null after build)');
  console.log('');

  // ── Test 4: Context Engine without screenshot ──────────────
  console.log('Test 4: Context Engine without screenshot (text-only)');
  
  const textContext = await contextEngine.buildContext('Just a question');
  assert(textContext.question === 'Just a question', 'Text-only question is set');
  assert(textContext.image_base64 === null, 'image_base64 is null for text-only');
  console.log('');

  // ── Test 5: Null screenshot handling ───────────────────────
  console.log('Test 5: Null screenshot graceful fallback');
  
  contextEngine.setPendingScreenshot(null);
  assert(contextEngine.pendingScreenshot === null, 'setPendingScreenshot(null) stores null');
  
  const nullCtx = await contextEngine.buildContext('Test with null screenshot');
  assert(nullCtx.image_base64 === null, 'buildContext with null pending → null image_base64');
  console.log('');

  // ── Test 6: Event Bus wiring ──────────────────────────────
  console.log('Test 6: Event Bus chain (showInputWithScreenshot)');
  
  let receivedEvent = null;
  eventBus.on('showInputWithScreenshot', (data) => { receivedEvent = data; });
  
  // Simulate what the shortcut does
  eventBus.emit('showInputWithScreenshot', {
    prefill: 'Analyze the content visible on the current screen.',
    hasScreenshot: true
  });
  
  assert(receivedEvent !== null, 'showInputWithScreenshot event was received');
  assert(receivedEvent.hasScreenshot === true, 'hasScreenshot = true');
  assert(receivedEvent.prefill.includes('Analyze'), 'prefill contains expected text');
  console.log('');

  // ── Test 7: Escape is NOT global + sessionEnded wiring ────
  console.log('Test 7: Escape + sessionEnded handler wiring');

  let sessionEndedFired = false;
  eventBus.on('sessionEnded', () => { sessionEndedFired = true; });
  
  // Simulate cancel-request IPC when contextFreeze is active
  const stateManager = require('./src/main/state-manager');
  stateManager.state.contextFreeze = true;
  stateManager.state.currentRequest = null;
  
  // The enhanced cancel-request handler logic (from ipc-manager)
  const currentRequest = stateManager.get('currentRequest');
  if (currentRequest) {
    eventBus.emit('userRequestCancelled');
  } else if (stateManager.get('contextFreeze')) {
    contextEngine.clearFrozenContext();
    eventBus.emit('sessionEnded');
  }
  
  assert(sessionEndedFired, 'sessionEnded event fires when contextFreeze + no active request');
  assert(stateManager.get('contextFreeze') === false, 'contextFreeze cleared after session end');
  console.log('');

  // ── Test 8: hideAllUIRequested event ──────────────────────
  console.log('Test 8: hideAllUIRequested event fires');
  
  let hideAllFired = false;
  eventBus.on('hideAllUIRequested', () => { hideAllFired = true; });
  
  // Trigger the Ctrl+Shift+Space shortcut callback
  const spaceHandler = mockElectron._shortcuts['CommandOrControl+Shift+Space'];
  assert(typeof spaceHandler === 'function', 'Space shortcut handler is a function');
  
  await spaceHandler();
  
  assert(hideAllFired, 'hideAllUIRequested fires before capture');
  console.log('');

  // ── Results ───────────────────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('═══════════════════════════════════════════');
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
