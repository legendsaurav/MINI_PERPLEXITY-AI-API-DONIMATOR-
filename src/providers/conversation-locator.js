const selectorManager = require('./selector-manager');
const hiddenBrowserManager = require('./hidden-browser-manager');

/**
 * Conversation Locator
 * Finds and restores previous conversations by interacting with the UI sidebar.
 */
class ConversationLocator {
  /**
   * Search sidebar for title and click it
   * @param {string} provider 
   * @param {string} conversationTitle 
   * @returns {Promise<boolean>} success
   */
  async restoreConversation(provider, conversationTitle) {
    if (!conversationTitle) return false;

    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) return false;

    const selectors = selectorManager.getSelectors(provider);

    const success = await win.webContents.executeJavaScript(`
      (function() {
        const titleElements = document.querySelectorAll('${selectors.sidebarChatList} ${selectors.chatTitle}');
        for (let el of titleElements) {
          if (el.innerText.trim() === '${conversationTitle.replace(/'/g, "\\'")}') {
            el.closest('a').click();
            return true;
          }
        }
        return false;
      })();
    `);

    return success;
  }
}

module.exports = new ConversationLocator();
