const { execSync } = require('child_process');
const eventBus = require('./event-bus');

/**
 * PowerShell one-liner that returns { title, process, path } for the
 * foreground window using Win32 user32.dll calls.
 */
const PS_COMMAND = `powershell -NoProfile -NonInteractive -Command "` +
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;` +
  `[StructLayout(LayoutKind.Sequential)]public struct RECT{public int Left;public int Top;public int Right;public int Bottom;}` +
  `public class FGWin{` +
  `[DllImport(\\\"user32.dll\\\")]public static extern IntPtr GetForegroundWindow();` +
  `[DllImport(\\\"user32.dll\\\")]public static extern int GetWindowText(IntPtr h,StringBuilder t,int c);` +
  `[DllImport(\\\"user32.dll\\\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);` +
  `[DllImport(\\\"user32.dll\\\")]public static extern bool GetWindowRect(IntPtr h,out RECT r);` +
  `}' -PassThru | Out-Null; ` +
  `$h=[FGWin]::GetForegroundWindow(); ` +
  `$s=New-Object Text.StringBuilder 512; ` +
  `[FGWin]::GetWindowText($h,$s,512)|Out-Null; ` +
  `$p=0; [FGWin]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null; ` +
  `$pr=Get-Process -Id $p -EA 0; ` +
  `$r=New-Object RECT; [FGWin]::GetWindowRect($h,[ref]$r)|Out-Null; ` +
  `@{title=$s.ToString();process=$pr.ProcessName;path=$pr.Path;bounds=@{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom}}|ConvertTo-Json -Compress"`;

/** Process names that belong to the Electron app itself and should be ignored. */
const SELF_PROCESSES = new Set(['electron', 'desktop-ai-copilot']);

/** Window title substrings that identify the copilot's own windows. */
const SELF_TITLES = ['Universal AI Copilot', 'Desktop AI Copilot'];

/** Polling interval in milliseconds. */
const POLL_INTERVAL_MS = 20000;

/** How long a UCID must
 *  remain stable before we emit contextChanged (ms). */
const DEBOUNCE_MS = 30000;

// ---------------------------------------------------------------------------
// UCID generation helpers
// ---------------------------------------------------------------------------

/**
 * Try to extract a URL domain from a browser window title.
 * Typical pattern: "Page Title - domain.com - Google Chrome"
 */
function extractBrowserDomain(title) {
  // Many browsers show "Page Title - domain.com — Browser"
  const parts = title.split(/\s[-–—]\s/);
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts[i].trim();
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Derive a Universal Context ID from the window title and process name.
 * @param {string} title       - foreground window title
 * @param {string} processName - executable name (without extension)
 * @returns {{ ucid: string, displayName: string }}
 */
function generateUCID(title, processName) {
  const proc = (processName || '').toLowerCase();

  // --- VS Code ---
  if (proc === 'code' || proc === 'code - insiders') {
    // Title format: "file.js - ProjectName - Visual Studio Code"
    const parts = title.split(/\s[-–—]\s/);
    if (parts.length >= 3) {
      const project = parts[parts.length - 2].trim();
      return { ucid: `vscode::${project}`, displayName: project };
    }
    if (parts.length === 2) {
      const project = parts[0].trim();
      return { ucid: `vscode::${project}`, displayName: project };
    }
    return { ucid: 'vscode::unknown', displayName: 'VS Code' };
  }

  // --- Android Studio ---
  if (proc === 'studio64' || proc === 'studio') {
    // Title format: "ProjectName – file.kt [module] – Android Studio"
    const parts = title.split(/\s[-–—]\s/);
    if (parts.length >= 2) {
      const project = parts[0].trim();
      return { ucid: `androidstudio::${project}`, displayName: project };
    }
    return { ucid: 'androidstudio::unknown', displayName: 'Android Studio' };
  }

  // --- Microsoft Word ---
  if (proc === 'winword') {
    const parts = title.split(/\s[-–—]\s/);
    const doc = parts[0].trim();
    return { ucid: `word::${doc}`, displayName: doc };
  }

  // --- Microsoft PowerPoint ---
  if (proc === 'powerpnt') {
    const parts = title.split(/\s[-–—]\s/);
    const doc = parts[0].trim();
    return { ucid: `powerpoint::${doc}`, displayName: doc };
  }

  // --- Browsers ---
  if (['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'].includes(proc)) {
    const domain = extractBrowserDomain(title);
    if (domain) {
      return { ucid: `browser::${domain}`, displayName: domain };
    }
    return { ucid: `browser::unknown`, displayName: processName };
  }

  // --- Generic fallback ---
  return { ucid: `app::${proc}`, displayName: processName || 'Unknown' };
}

// ---------------------------------------------------------------------------
// ContextDetector class
// ---------------------------------------------------------------------------

/**
 * Context Detector
 * Polls the foreground window at a fixed interval, derives a UCID, and emits
 * `contextChanged` on the event bus after the UCID has been stable for a
 * configurable debounce period.
 */
class ContextDetector {
  constructor() {
    /** @type {ReturnType<typeof setInterval>|null} */
    this._pollTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._debounceTimer = null;

    /** Whether detection is enabled. */
    this._enabled = true;

    /** Last emitted context (to avoid duplicate events). */
    this._lastEmittedUcid = null;

    /** Candidate UCID waiting for the debounce window to pass. */
    this._candidateUcid = null;

    /** Timestamp when the candidate was first seen. */
    this._candidateSince = 0;

    /** The most recently detected raw context. */
    this._currentContext = null;
  }

  /**
   * Start polling the foreground window.
   */
  start() {
    if (this._pollTimer) return; // already running
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stop polling and clear pending debounce timers.
   */
  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * Enable or disable context detection at runtime.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = !!enabled;
    if (!this._enabled) {
      // Clear any pending debounce when disabling
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      this._candidateUcid = null;
    }
  }

  /**
   * Return the most recently detected context.
   * @returns {{ ucid: string, processName: string, windowTitle: string, displayName: string }|null}
   */
  getCurrentContext() {
    return this._currentContext;
  }

  /**
   * Perform an immediate synchronous poll of the foreground window and return
   * the fresh context. Unlike the periodic _poll(), this skips debounce and
   * UCID logic — it only updates _currentContext and returns it.
   * Used by the agent screenshot endpoint to get real-time window bounds.
   * @returns {{ ucid: string, processName: string, windowTitle: string, displayName: string, bounds: object }|null}
   */
  pollNow() {
    let info;
    try {
      const raw = execSync(PS_COMMAND, {
        windowsHide: true,
        timeout: 5000,
        encoding: 'utf8',
      });
      info = JSON.parse(raw);
    } catch {
      return this._currentContext; // fallback to last known
    }

    const windowTitle = info.title || '';
    const processName = info.process || '';

    // Ignore the copilot's own windows — return last known non-self context
    if (SELF_PROCESSES.has(processName.toLowerCase())) return this._currentContext;
    if (SELF_TITLES.some((s) => windowTitle.includes(s))) return this._currentContext;

    const { ucid, displayName } = generateUCID(windowTitle, processName);
    this._currentContext = { ucid, processName, windowTitle, displayName, bounds: info.bounds };
    return this._currentContext;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Single poll cycle: read the foreground window, generate a UCID, and
   * manage the debounce window.
   * @private
   */
  _poll() {
    if (!this._enabled) return;

    let info;
    try {
      const raw = execSync(PS_COMMAND, {
        windowsHide: true,
        timeout: 5000,
        encoding: 'utf8',
      });
      info = JSON.parse(raw);
    } catch {
      // PowerShell hiccup – skip this cycle
      return;
    }

    const windowTitle = info.title || '';
    const processName = info.process || '';

    // Ignore the copilot's own windows
    if (SELF_PROCESSES.has(processName.toLowerCase())) return;
    if (SELF_TITLES.some((s) => windowTitle.includes(s))) return;

    const { ucid, displayName } = generateUCID(windowTitle, processName);

    // Update the raw "current context" snapshot
    this._currentContext = { ucid, processName, windowTitle, displayName, bounds: info.bounds };

    // --- Debounce logic ---
    if (ucid === this._lastEmittedUcid) {
      // Context hasn't changed from what we already emitted – reset candidate
      this._candidateUcid = null;
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      return;
    }

    if (ucid !== this._candidateUcid) {
      // New candidate – start the debounce window
      this._candidateUcid = ucid;
      this._candidateSince = Date.now();

      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._emitChange({ ucid, processName, windowTitle, displayName });
      }, DEBOUNCE_MS);
    }
    // If the candidate is the same, the existing timer is still ticking – no action needed.
  }

  /**
   * Emit the contextChanged event and update bookkeeping.
   * @private
   */
  _emitChange(context) {
    this._lastEmittedUcid = context.ucid;
    this._candidateUcid = null;
    this._debounceTimer = null;

    eventBus.emit('contextChanged', context);
  }
}

module.exports = new ContextDetector();
