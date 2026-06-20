/**
 * Selector Manager
 * Centralized repository for all DOM selectors for all supported providers.
 * Makes updating to web UI changes trivial.
 */
const SELECTORS = {
  chatgpt: {
    // The main input area
    textarea: '#prompt-textarea',
    // The submit arrow/button
    sendButton: '[data-testid="send-button"]',
    // The button that stops generation
    stopButton: '[data-testid="stop-button"], button[aria-label="Stop generating"]',
    // The container holding the assistant's response blocks
    responseArea: '[data-message-author-role="assistant"]',
    // Sidebar list of previous chats
    sidebarChatList: 'nav[aria-label="Chat history"] a',
    // The title element inside the sidebar list item
    chatTitle: 'div.relative.grow.overflow-hidden',
    // Indicator that a stream is currently active (e.g. the stop button exists)
    streamingIndicator: '[data-testid="stop-button"]'
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
