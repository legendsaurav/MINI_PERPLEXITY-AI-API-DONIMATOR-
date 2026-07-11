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
    sendButton: '[data-testid*="send-button"], [data-testid*="send"], button[aria-label*="Send" i], button[type="submit"]',
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
    stopButton: 'button[aria-label="Stop generating"], button[aria-label*="Stop" i]',
    responseArea: 'message-content, .model-response-text, .markdown.markdown-main-panel, div[id^="model-response-message-content"]',
    sidebarChatList: '.recent-conversations-list li',
    chatTitle: '.conversation-title',
    streamingIndicator: 'loading-indicator, button[aria-label="Stop generating"], button[aria-label*="Stop" i], .blue-circle.stop-icon'
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
    textarea: '.chat-input-editor, [contenteditable="true"], textarea',
    sendButton: '.send-button-container, div[class*="send-button"], button[class*="send"], [data-testid*="send"], button[type="submit"]',
    stopButton: 'button[class*="stop"], div[class*="stop"]',
    responseArea: '.segment-assistant, .markdown, .markdown-body, div[class*="segment-content"], div[class*="assistant"] div[class*="markdown"]',
    sidebarChatList: 'a[href*="/chat/"]',
    chatTitle: 'span',
    streamingIndicator: 'div[class*="loading"], .animate-pulse, button[class*="stop"], div[class*="stop"]'
  },
  deepseek: {
    textarea: 'textarea.ds-scroll-area, textarea[placeholder*="DeepSeek" i], textarea[placeholder*="Message" i], #chat-input',
    sendButton: 'div[class*="ds-button--circle"], div[role="button"].ds-button--circle, div[class*="send-button"], button[data-testid*="send"], button[class*="send"]',
    stopButton: 'div[class*="stop-button"], button[class*="stop"], div[role="button"][class*="stop"]',
    responseArea: 'div[class*="ds-markdown"], .ds-markdown, div[class*="message-content"], div[class*="_4f9bf79"], div[class*="_9663006"]',
    sidebarChatList: 'div[class*="sidebar-item"]',
    chatTitle: 'div[class*="title"]',
    streamingIndicator: 'div[class*="loading"], .animate-pulse, div[class*="stop-button"], div[role="button"][class*="stop"]'
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
