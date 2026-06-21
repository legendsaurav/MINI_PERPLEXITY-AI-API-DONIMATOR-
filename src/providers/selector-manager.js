/**
 * Selector Manager
 * Centralized repository for all DOM selectors for all supported providers.
 * Makes updating to web UI changes trivial.
 */
const SELECTORS = {
  chatgpt: {
    textarea: '#prompt-textarea, [data-testid="composer-input"], div.ProseMirror, textarea.wcDTda_fallbackTextarea',
    sendButton: '[data-testid="send-button"], [data-testid="composer-submit-button"], button.composer-submit-btn, #composer-submit-button',
    stopButton: '[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop"]',
    responseArea: '[data-message-author-role="assistant"], div.agent-turn, div.markdown.prose',
    sidebarChatList: 'nav[aria-label="Chat history"] a, [data-testid="history-item"]',
    chatTitle: 'div.relative.grow.overflow-hidden',
    streamingIndicator: '[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop"]'
  },
  gemini: {
    textarea: 'rich-textarea p',
    sendButton: 'button[aria-label="Send message"]',
    stopButton: 'button[aria-label="Stop generating"]',
    responseArea: 'message-content',
    sidebarChatList: '.recent-conversations-list li',
    chatTitle: '.conversation-title',
    streamingIndicator: 'loading-indicator'
  },
  claude: {
    textarea: '[contenteditable="true"]',
    sendButton: 'button[aria-label="Send Message"]',
    stopButton: 'button[aria-label="Stop generating"]',
    responseArea: '.font-claude-message',
    sidebarChatList: 'nav a',
    chatTitle: '.truncate',
    streamingIndicator: '.animate-pulse'
  },
  kimi: {
    textarea: '.chat-input-editor',
    sendButton: '.send-button-container',
    stopButton: '.send-button-container.stop, .stop-button-container, .stop-btn',
    responseArea: '.chat-content-item-assistant .markdown-container:not(.toolcall-content-text) .markdown',
    sidebarChatList: 'nav a',
    chatTitle: '.title-text',
    streamingIndicator: '.send-button-container.stop, .kimi-streaming, .stop-button-container'
  },
  deepseek: {
    textarea: 'textarea',
    sendButton: 'div[role="button"].ds-button--primary, button.send-btn',
    stopButton: '.ds-loading',
    responseArea: '.ds-markdown.ds-assistant-message-main-content',
    sidebarChatList: 'a._546d736',
    chatTitle: '.c08e6e93',
    streamingIndicator: '.ds-loading'
  },
  googlesearch: {
    textarea: 'textarea[type="search"], input[name="q"]',
    sendButton: 'input[type="submit"], button[type="submit"]',
    stopButton: 'button.stop-btn',
    responseArea: 'div[data-ved], .g, #search',
    sidebarChatList: '#search a',
    chatTitle: '.title',
    streamingIndicator: '#loading'
  }
};

class SelectorManager {
  /**
   * Get all selectors for a given provider
   * @param {string} provider 
   * @returns {object}
   */
  getSelectors(provider) {
    if (!SELECTORS[provider]) {
      throw new Error(`No selectors defined for provider: ${provider}`);
    }
    return SELECTORS[provider];
  }
}

module.exports = new SelectorManager();
