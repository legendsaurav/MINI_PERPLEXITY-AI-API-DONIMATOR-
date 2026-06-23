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
    sendButton: 'button[aria-label*="Send"], button[aria-label*="send"]',
    stopButton: 'button[aria-label*="Stop"], button[aria-label*="stop"]',
    responseArea: '.font-claude-response',
    sidebarChatList: 'nav a',
    chatTitle: '.truncate',
    streamingIndicator: '.animate-pulse'
  },
  kimi: {
    textarea: '[contenteditable="true"], textarea',
    sendButton: 'button[class*="send"], [data-testid*="send"], button[type="submit"]',
    stopButton: 'button[class*="stop"]',
    responseArea: 'div[class*="message"], .markdown-body',
    sidebarChatList: 'a[href*="/chat/"]',
    chatTitle: 'span',
    streamingIndicator: 'div[class*="loading"], .animate-pulse'
  },
  deepseek: {
    textarea: '#chat-input',
    sendButton: 'div[class*="send-button"], button[data-testid*="send"], button[class*="send"]',
    stopButton: 'div[class*="stop-button"], button[class*="stop"]',
    responseArea: 'div[class*="message-content"], .ds-markdown',
    sidebarChatList: 'div[class*="sidebar-item"]',
    chatTitle: 'div[class*="title"]',
    streamingIndicator: 'div[class*="loading"], .animate-pulse'
  },
  perplexity: {
    textarea: 'textarea',
    sendButton: 'button[class*="submit"], button[aria-label*="Submit"]',
    stopButton: 'button[aria-label*="Stop"], button[class*="stop"]',
    responseArea: 'div.prose, [class*="prose"]',
    sidebarChatList: 'a[href*="/search"]',
    chatTitle: 'div.truncate',
    streamingIndicator: 'div[class*="loading"], .animate-pulse'
  },
  google: {
    textarea: 'textarea[name="q"], input[name="q"], textarea.ITIRGe, textarea[placeholder*="Ask" i]',
    sendButton: 'input[name="btnK"], button[type="submit"], button[aria-label="Send"], button.wdK4Nc',
    stopButton: 'button[aria-label*="Stop"], button[aria-label*="stop"], button.sisB6e',
    responseArea: 'div[data-as-type="5"], div.sge-container, div[jsname="N62Oeb"], [data-testid*="ai-overview"], div[class*="ai-overview"], div.Zkbeff div.pWvJNd, #aim-chrome-initial-inline-async-container',
    sidebarChatList: 'a[href*="/search"]',
    chatTitle: 'span',
    streamingIndicator: '.animate-pulse, button[aria-label="Stop"]'
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
