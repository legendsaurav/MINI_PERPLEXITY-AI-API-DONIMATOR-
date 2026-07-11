const eventBus = require('./event-bus');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Keys that are persisted to disk.
 * Everything else is volatile and lives only in-memory.
 */
const PERSISTED_KEYS = new Set(['currentProject', 'currentProvider', 'apiKey', 'screenshotDelays', 'constantConversationUrl']);

/**
 * Simple JSON file-based persistence (electron-store is ESM-only v10+).
 */
class PersistentStore {
  constructor(filePath, defaults) {
    this._filePath = filePath;
    this._defaults = defaults;
    this._data = { ...defaults };

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this._data = { ...defaults, ...parsed };
      }
    } catch (err) {
      console.error('[StateManager] Failed to load persisted state:', err.message);
    }
  }

  get(key) {
    return this._data[key] !== undefined ? this._data[key] : this._defaults[key];
  }

  set(key, value) {
    this._data[key] = value;
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2), 'utf8');
    } catch (err) {
      console.error('[StateManager] Failed to persist state:', err.message);
    }
  }
}

/**
 * State Manager
 * Single source of truth for global application state.
 * Persists critical keys across restarts.
 */
class StateManager {
  constructor() {
    // Persistent store — simple JSON file in userData
    const storePath = path.join(app.getPath('userData'), 'copilot-state.json');
    this.store = new PersistentStore(storePath, {
      currentProject: null,
      currentProvider: 'chatgpt',
      apiKey: null,
      constantConversationUrl: {
        chatgpt: null,
        gemini: null,
        claude: null,
        kimi: null,
        deepseek: null,
        perplexity: null,
        google: null
      },
      screenshotDelays: {
        chatgpt: 8,
        gemini: 5,
        claude: 5,
        kimi: 5,
        deepseek: 5,
        perplexity: 5,
        google: 4
      }
    });

    // In-memory state — merge persisted values with volatile defaults
    this.state = {
      ...this.store._data,
      currentRequest: null,
      currentSession: {
        active: false,
        provider: null,
      },
      contextFreeze: false,
      overlayVisibility: false,
      activeConversation: null,
    };

    // Auto-generate API key if not present
    if (!this.state.apiKey) {
      const crypto = require('crypto');
      const newKey = 'sk-' + crypto.randomUUID().replace(/-/g, '');
      this.state.apiKey = newKey;
      this.store.set('apiKey', newKey);
      console.log(`[StateManager] Generated new API Key: ${newKey}`);
    } else {
      console.log(`[StateManager] Using existing API Key: ${this.state.apiKey}`);
    }
  }

  /**
   * Get the entire state or a specific key
   * @param {string} [key]
   * @returns {any}
   */
  get(key) {
    if (key) {
      return this.state[key];
    }
    return this.state;
  }

  /**
   * Update state and emit change event.
   * Persisted keys are written to disk automatically.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this.state[key] !== value) {
      this.state[key] = value;

      // Write through to disk for persisted keys
      if (PERSISTED_KEYS.has(key)) {
        this.store.set(key, value);
      }

      eventBus.emit('stateChanged', { key, value });

      // Emit specific events for critical state changes
      if (key === 'currentProject') eventBus.emit('projectChanged', value);
      if (key === 'currentProvider') eventBus.emit('providerChanged', value);
    }
  }

  /**
   * Partially update complex state objects
   * @param {string} key
   * @param {object} updates
   */
  update(key, updates) {
    if (typeof this.state[key] === 'object' && this.state[key] !== null) {
      this.state[key] = { ...this.state[key], ...updates };
      eventBus.emit('stateChanged', { key, value: this.state[key] });
    }
  }

  isConversationUrl(provider, urlStr) {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      const path = parsed.pathname;
      
      if (provider === 'chatgpt') {
        return path.includes('/c/');
      }
      if (provider === 'gemini') {
        return path.includes('/app/') && path.split('/').filter(Boolean).length >= 2;
      }
      if (provider === 'claude') {
        return path.includes('/chat/');
      }
      if (provider === 'deepseek') {
        return path.includes('/chat') && path.split('/').filter(Boolean).length >= 2;
      }
      if (provider === 'perplexity') {
        return path.includes('/search/');
      }
      if (provider === 'kimi') {
        return path.includes('/chat/');
      }
      if (provider === 'google') {
        return false;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  getConstantUrl(provider) {
    const urls = this.get('constantConversationUrl');
    if (urls && typeof urls === 'object') {
      return urls[provider] || null;
    }
    // Auto-migrate legacy string format to per-provider object
    if (typeof urls === 'string') {
      console.log(`[StateManager] Migrating legacy constantConversationUrl string to object format`);
      const migrated = {
        chatgpt: urls.includes('chatgpt.com') ? urls : null,
        gemini: urls.includes('gemini.google.com') ? urls : null,
        claude: urls.includes('claude.ai') ? urls : null,
        kimi: urls.includes('kimi.') ? urls : null,
        deepseek: urls.includes('deepseek.com') ? urls : null,
        perplexity: urls.includes('perplexity.ai') ? urls : null,
        google: null
      };
      this.set('constantConversationUrl', migrated);
      return migrated[provider] || null;
    }
    return null;
  }

  setConstantUrl(provider, urlStr) {
    let urls = this.get('constantConversationUrl');
    if (!urls || typeof urls !== 'object') {
      urls = {
        chatgpt: null,
        gemini: null,
        claude: null,
        kimi: null,
        deepseek: null,
        perplexity: null,
        google: null
      };
    }
    urls[provider] = urlStr;
    this.set('constantConversationUrl', urls);
  }
}

module.exports = new StateManager();
