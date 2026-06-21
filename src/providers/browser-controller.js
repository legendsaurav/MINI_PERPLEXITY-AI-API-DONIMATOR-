const { nativeImage, clipboard } = require('electron');
const selectorManager = require('./selector-manager');
const hiddenBrowserManager = require('./hidden-browser-manager');
const eventBus = require('../main/event-bus');
const providerCapabilities = require('./provider-capabilities');

/**
 * Browser Controller
 * Executes specific JS commands in the hidden BrowserWindow to manipulate
 * the DOM (inject prompts, attach observers).
 */
class BrowserController {
  async safeExecuteJavaScript(win, code, timeoutMs = 8000) {
    try {
      return await Promise.race([
        win.webContents.executeJavaScript(code),
        new Promise((_, reject) => setTimeout(() => reject(new Error('executeJavaScript timeout')), timeoutMs))
      ]);
    } catch (err) {
      console.warn(`[BrowserController] safeExecuteJavaScript warning: ${err.message}`);
      return null;
    }
  }
  
  async injectAndSubmit(provider, promptString) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    const selectors = selectorManager.getSelectors(provider);
    
    // Safely escape the string for injection
    const safePrompt = JSON.stringify(promptString);

    console.log(`[BrowserController] Injecting prompt into ${provider}...`);

    let injected;
    if (provider === 'googlesearch') {
      injected = await this.safeExecuteJavaScript(win, `
        (async function() {
          console.log('[Injected] Running googlesearch-specific inject and submit...');
          
          async function waitForElement(selector, timeout = 10000) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              let el = document.querySelector(selector) || 
                       document.querySelector('textarea[placeholder*="Ask"]') || 
                       document.querySelector('textarea.ITIRGe') || 
                       document.querySelector('textarea[name="q"]') || 
                       document.querySelector('input[name="q"]');
              if (el) return el;
              await new Promise(r => setTimeout(r, 200));
            }
            return null;
          }

          const target = await waitForElement('${selectors.textarea}');
          if (!target) {
            console.error('[Injected] No input element found at all!');
            if (window.__aiCopilot) window.__aiCopilot.sendError('Textarea not found');
            return false;
          }

          console.log('[Injected] Found input element, focusing and injecting...');
          target.focus();
          
          if (target.getAttribute('contenteditable') === 'true' || target.contentEditable === 'true') {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(target);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, ${safePrompt});
          } else {
            if (target.select) target.select();
            document.execCommand('insertText', false, ${safePrompt});
          }

          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          
          await new Promise(r => setTimeout(r, 600));

          // Check if we are on Google homepage
          const isHomepage = window.location.pathname === '/' || window.location.pathname === '/webhp';
          
          if (isHomepage) {
            const buttons = Array.from(document.querySelectorAll('button'));
            const aiModeBtn = buttons.find(b => b.textContent.trim().toLowerCase().includes('ai mode')) ||
                              document.querySelector('button.plR5qb');
            if (aiModeBtn) {
              console.log('[Injected] Found AI Mode button on homepage, clicking it...');
              aiModeBtn.click();
              return { clicked: true, mode: 'ai_mode_btn' };
            }
          }

          // Fallback for results page or if AI Mode button not found:
          let sendBtn = null;
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          sendBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'submit') ||
                    document.querySelector('button.SAvKK') ||
                    document.querySelector('input[type="submit"]') ||
                    document.querySelector('button[type="submit"]');

          const isDisabled = sendBtn && (
            sendBtn.disabled || 
            sendBtn.getAttribute('aria-disabled') === 'true' ||
            (sendBtn.className && typeof sendBtn.className === 'string' && sendBtn.className.includes('disabled'))
          );

          if (sendBtn && !isDisabled) {
            console.log('[Injected] Found active send button, clicking...');
            sendBtn.click();
            return { clicked: true, mode: 'send_btn' };
          } else {
            console.log('[Injected] Send button not found or disabled, fallback to Enter key...');
            target.focus();
            target.dispatchEvent(new KeyboardEvent('keydown', { 
              key: 'Enter', 
              code: 'Enter', 
              keyCode: 13, 
              which: 13, 
              bubbles: true 
            }));
            return { clicked: false, fallbackEnter: true };
          }
        })();
      `);
    } else {
      injected = await this.safeExecuteJavaScript(win, `
        (async function() {
          console.log('[Injected] Waiting for textarea: ${selectors.textarea}');
          
          async function waitForElement(selector, timeout = 10000) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              let el = document.querySelector(selector) || document.querySelector('#prompt-textarea');
              if (!el) {
                el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
              }
              if (el) return el;
              await new Promise(r => setTimeout(r, 200));
            }
            return null;
          }

          const target = await waitForElement('${selectors.textarea}');
          if (!target) {
            console.error('[Injected] No input element found at all within timeout!');
            if (window.__aiCopilot) window.__aiCopilot.sendError('Textarea not found');
            return false;
          }

          console.log('[Injected] Found input element, focusing and injecting...');
          target.focus();
          
          // Use document.execCommand('insertText') to trigger framework events properly
          if (target.getAttribute('contenteditable') === 'true' || target.contentEditable === 'true') {
            // Select all text and replace
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(target);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, ${safePrompt});
          } else {
            // Select all and replace
            target.select();
            document.execCommand('insertText', false, ${safePrompt});
          }

          // Fire framework input/change events
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Wait briefly, then try to submit
          await new Promise(r => setTimeout(r, 600));

          console.log('[Injected] Looking for send button: ${selectors.sendButton}');
          let sendBtn = document.querySelector('${selectors.sendButton}');
          if (!sendBtn) {
            // Fallbacks for Kimi and other providers
            sendBtn = document.querySelector('button[type="submit"]') || 
                      document.querySelector('[class*="send"]') || 
                      Array.from(document.querySelectorAll('button')).find(b => {
                        const cls = (b.className || '').toString().toLowerCase();
                        const id = (b.id || '').toString().toLowerCase();
                        return cls.includes('submit') || cls.includes('send') || id.includes('submit') || id.includes('send');
                      });
          }

          // Check if button is actually disabled (checking class list as well since div doesn't support disabled property)
          const isDisabled = sendBtn && (
            sendBtn.disabled || 
            sendBtn.getAttribute('aria-disabled') === 'true' ||
            (sendBtn.className && typeof sendBtn.className === 'string' && sendBtn.className.includes('disabled'))
          );

          if (sendBtn && !isDisabled) {
            console.log('[Injected] Found active send button, clicking...');
            sendBtn.click();
            return { clicked: true };
          } else {
            console.log('[Injected] Send button not found or disabled, fallback to Enter key...');
            target.focus();
            target.dispatchEvent(new KeyboardEvent('keydown', { 
              key: 'Enter', 
              code: 'Enter', 
              keyCode: 13, 
              which: 13, 
              bubbles: true 
            }));
            return { clicked: false, fallbackEnter: true };
          }
        })();
      `);
    }

    console.log(`[BrowserController] Prompt injection result:`, injected);

    // If it fell back to Enter key or we want to guarantee submission, send native Electron Return input events
    if (injected && injected.fallbackEnter) {
      console.log(`[BrowserController] Sending native Return input events...`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      await this._sleep(50);
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }

    console.log(`[BrowserController] Prompt injection complete.`);
  }

  async attachStreamObserver(provider) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    if (provider === 'googlesearch') {
      console.log(`[BrowserController] Setting up observer for googlesearch...`);

      const sgeObserverScript = `
        (function() {
          console.log('[SGE Observer] Setting up MutationObserver...');
          if (window.__sgeObserver) {
            window.__sgeObserver.disconnect();
            console.log('[SGE Observer] Disconnected previous observer.');
          }
          if (window.__sgeStabilityTimer) {
            clearTimeout(window.__sgeStabilityTimer);
          }

          const getSGEContent = () => {
            // 1. Try SGE Conversational turn response
            const turns = Array.from(document.querySelectorAll('div[data-scope-id="turn"]'));
            if (turns.length > 0) {
              const lastTurn = turns[turns.length - 1];
              
              // Target .mZJni container if present (reliable for complete answer text)
              const mZJni = lastTurn.querySelector('.mZJni');
              if (mZJni) {
                const responseEl = mZJni.children[0] || mZJni;
                let text = (responseEl.innerText || '').trim();
                if (text) return { text, type: 'conversational' };
              }
              
              // Fallback: Find closest common ancestor of all response blocks (.n6owBd, .pTRUV, .ALfJzf)
              const blocks = Array.from(lastTurn.querySelectorAll('.n6owBd, .pTRUV, .ALfJzf'));
              if (blocks.length > 0) {
                let ancestor = blocks[0];
                if (blocks.length > 1) {
                  let temp = blocks[0].parentElement;
                  while (temp && lastTurn.contains(temp)) {
                    if (blocks.every(b => temp.contains(b))) {
                      ancestor = temp;
                      break;
                    }
                    temp = temp.parentElement;
                  }
                }
                let text = (ancestor.innerText || '').trim();
                if (text) return { text, type: 'conversational' };
              }
              
              // Ultimate fallback: Turn inner text cleaned of feedback noise
              let text = (lastTurn.innerText || '')
                .replace(/copy/gi, '')
                .replace(/(?:was this helpful\\\\?|send feedback|learn more|feedback)/gi, '')
                .trim();
              return { text, type: 'conversational' };
            }


            // 2. Try SGE AI Overview card
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span'));
            let aiHeader = headings.find(el => el.textContent.trim().toLowerCase() === 'ai overview');
            if (aiHeader) {
              let container = aiHeader.parentElement;
              for (let i = 0; i < 5; i++) {
                if (container) {
                  const text = container.innerText || '';
                  if (text.length > 150) {
                    const cleanText = text
                      .replace(/ai overview/gi, '')
                      .replace(/(?:was this helpful\\\\?|send feedback|learn more|feedback)/gi, '')
                      .trim();
                    return { text: cleanText, type: 'overview' };
                  }
                  container = container.parentElement;
                }
              }
            }

            // 3. Fallback to standard search results
            const searchResults = document.querySelector('#search');
            if (searchResults) {
              const gElements = Array.from(document.querySelectorAll('.g'));
              if (gElements.length > 0) {
                let resultsText = "## 🔍 Search Results (AI Overview not generated)\\n\\n";
                gElements.slice(0, 5).forEach((el, index) => {
                  const titleEl = el.querySelector('h3');
                  const title = titleEl ? titleEl.innerText : 'Result ' + (index + 1);
                  const linkEl = el.querySelector('a');
                  const link = linkEl ? linkEl.getAttribute('href') : '';
                  const snippetEl = el.querySelector('div[style*="webkit-line-clamp"], .VwiC3d, .yD755b');
                  const snippet = snippetEl ? snippetEl.innerText : el.innerText.substring(0, 300);
                  
                  resultsText += '### ' + title + '\\n';
                  if (link) {
                    resultsText += 'Link: [' + title + '](' + link + ')\\n';
                  }
                  resultsText += snippet + '\\n\\n';
                });
                return { text: resultsText, type: 'classic' };
              }
            }

            return { text: '', type: 'none' };
          };

          const initialContent = getSGEContent();
          let lastText = initialContent.text;
          let hasStarted = lastText.length > 0;
          let completionSent = false;

          console.log('[SGE Observer] Initial text length:', lastText.length, 'type:', initialContent.type);

          function sendCompletion(finalText) {
            if (completionSent) return;
            completionSent = true;
            console.log('[SGE Observer] Complete! Final text length:', finalText.length);
            
            window.postMessage({ type: '__copilot_complete', data: { fullText: finalText } }, '*');
            
            if (window.__sgeObserver) {
              window.__sgeObserver.disconnect();
            }
            if (window.__sgeStabilityTimer) {
              clearTimeout(window.__sgeStabilityTimer);
            }
          }

          function resetStabilityTimer() {
            if (window.__sgeStabilityTimer) {
              clearTimeout(window.__sgeStabilityTimer);
            }
            window.__sgeStabilityTimer = setTimeout(() => {
              if (hasStarted && !completionSent) {
                console.log('[SGE Observer] Stability timeout triggered completion.');
                const content = getSGEContent();
                sendCompletion(content.text);
              }
            }, 2500);
          }

          window.__sgeObserver = new MutationObserver(() => {
            const content = getSGEContent();
            const currentText = content.text;

            if (currentText !== lastText) {
              if (!hasStarted && currentText.length > 0) {
                hasStarted = true;
                console.log('[SGE Observer] Streaming started!');
              }
              lastText = currentText;
              if (currentText.length > 0) {
                window.postMessage({ type: '__copilot_sync', data: currentText }, '*');
                resetStabilityTimer();
              }
            }
          });

          window.__sgeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });

          console.log('[SGE Observer] MutationObserver active.');
          
          if (hasStarted) {
            resetStabilityTimer();
          } else {
            window.__sgeStabilityTimer = setTimeout(() => {
              if (!hasStarted && !completionSent) {
                console.log('[SGE Observer] Failsafe: no content appeared within 10s. Sending fallback.');
                const content = getSGEContent();
                sendCompletion(content.text || 'No response fetched from Google Search AI Mode.');
              }
            }, 10000);
          }
        })();
      `;

      if (win.__googlesearchLoadListener) {
        win.webContents.removeListener('did-finish-load', win.__googlesearchLoadListener);
        win.webContents.removeListener('did-navigate-in-page', win.__googlesearchLoadListener);
      }

      win.__googlesearchLoadListener = async () => {
        const url = win.webContents.getURL();
        if (!url.includes('/search')) return;
        console.log(`[BrowserController] SGE search page loaded/navigated. Executing SGE Observer...`);
        await this._sleep(1000);
        await this.safeExecuteJavaScript(win, sgeObserverScript);
      };

      win.webContents.on('did-finish-load', win.__googlesearchLoadListener);
      win.webContents.on('did-navigate-in-page', win.__googlesearchLoadListener);

      const currentUrl = win.webContents.getURL();
      if (currentUrl.includes('/search')) {
        console.log(`[BrowserController] Already on search page. Running SGE Observer immediately...`);
        this.safeExecuteJavaScript(win, sgeObserverScript);
      }
      return;
    }

    const selectors = selectorManager.getSelectors(provider);

    console.log(`[BrowserController] Attaching MutationObserver for ${provider}...`);

    await this.safeExecuteJavaScript(win, `
      (function() {
        console.log('[Observer] Setting up MutationObserver...');

        if (window.__copilotObserver) {
          window.__copilotObserver.disconnect();
          console.log('[Observer] Disconnected previous observer.');
        }
        if (window.__copilotStabilityTimer) {
          clearTimeout(window.__copilotStabilityTimer);
        }

        // Snapshot: capture the current text of the LAST response node at attach time.
        // Anything beyond this text is "new" streaming content.
        const allNodesAtStart = document.querySelectorAll('${selectors.responseArea}');
        const lastNodeAtStart = allNodesAtStart.length > 0 ? allNodesAtStart[allNodesAtStart.length - 1] : null;
        const snapshotText = lastNodeAtStart ? (lastNodeAtStart.innerText || '') : '';
        const snapshotNodeCount = allNodesAtStart.length;
        
        console.log('[Observer] Snapshot: ' + snapshotNodeCount + ' nodes, ' + snapshotText.length + ' chars of existing text');

        let lastText = snapshotText; // Start tracking from the snapshot
        let currentNodeIndex = snapshotNodeCount - 1; // Track which node we are reading from
        let hasStarted = false;
        let completionSent = false;
        
        // Stability timer: only use this as a failsafe if the buttons don't give a clear signal
        function resetStabilityTimer() {
          if (window.__copilotStabilityTimer) {
            clearTimeout(window.__copilotStabilityTimer);
          }
          window.__copilotStabilityTimer = setTimeout(() => {
            if (hasStarted && !completionSent) {
              console.log('[Observer] Failsafe timer triggered completion.');
              sendCompletion();
            }
          }, 180000); // Increased to 180s (3m) to allow for deep image analysis
        }

        function sendCompletion() {
          if (completionSent) return;
          completionSent = true;
          
          const finalNodes = document.querySelectorAll('${selectors.responseArea}');
          const finalText = finalNodes.length > 0 ? convertToMarkdown(finalNodes[finalNodes.length - 1]).trim() : lastText;
          
          console.log('[Observer] Stream complete. Final text length:', finalText.length);
          window.postMessage({ type: '__copilot_complete', data: { fullText: finalText } }, '*');
          
          if (window.__copilotObserver) {
            window.__copilotObserver.disconnect();
          }
          if (window.__copilotStabilityTimer) {
            clearTimeout(window.__copilotStabilityTimer);
          }
        }
        
        function convertToMarkdown(n) {
          let md = '';
          for (const child of n.childNodes) {
            if (child.nodeType === 3) { // Text node
              md += child.textContent;
            } else if (child.nodeType === 1) { // Element node
              const tag = child.tagName.toLowerCase();
              if (tag === 'p') {
                md += convertToMarkdown(child) + '\\n\\n';
              } else if (tag === 'strong' || tag === 'b') {
                md += '**' + convertToMarkdown(child) + '**';
              } else if (tag === 'em' || tag === 'i') {
                md += '*' + convertToMarkdown(child) + '*';
              } else if (tag === 'pre') {
                const codeNode = child.querySelector('code');
                const lang = codeNode ? (codeNode.className.replace('language-', '') || '') : '';
                const codeText = codeNode ? codeNode.textContent : child.textContent;
                const b = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
                md += '\\n' + b + lang + '\\n' + codeText + '\\n' + b + '\\n\\n';
              } else if (tag === 'code') {
                md += String.fromCharCode(96) + child.textContent + String.fromCharCode(96);
              } else if (tag === 'a') {
                md += '[' + convertToMarkdown(child) + '](' + child.getAttribute('href') + ')';
              } else if (tag === 'ul') {
                for (const li of child.children) {
                  if (li.tagName.toLowerCase() === 'li') md += '- ' + convertToMarkdown(li).trim() + '\\n';
                }
                md += '\\n';
              } else if (tag === 'ol') {
                let i = 1;
                for (const li of child.children) {
                  if (li.tagName.toLowerCase() === 'li') md += (i++) + '. ' + convertToMarkdown(li).trim() + '\\n';
                }
                md += '\\n';
              } else if (tag === 'h1') { md += '# ' + convertToMarkdown(child) + '\\n\\n';
              } else if (tag === 'h2') { md += '## ' + convertToMarkdown(child) + '\\n\\n';
              } else if (tag === 'h3') { md += '### ' + convertToMarkdown(child) + '\\n\\n';
              } else if (tag === 'table') {
                const rows = child.querySelectorAll('tr');
                rows.forEach((row, i) => {
                  let rowMd = '|';
                  let sepMd = '|';
                  row.querySelectorAll('th, td').forEach(cell => {
                    rowMd += ' ' + convertToMarkdown(cell).replace(/\\|/g, '\\\\|').replace(/\\n/g, ' ') + ' |';
                    if (i === 0) sepMd += '---|';
                  });
                  md += rowMd + '\\n';
                  if (i === 0) md += sepMd + '\\n';
                });
                md += '\\n';
              } else if (tag === 'br') {
                md += '\\n';
              } else {
                md += convertToMarkdown(child);
              }
            }
          }
          return md;
        }

        window.__copilotObserver = new MutationObserver(() => {
          // Check if streaming finished via button states (do this first to prevent early return blinding)
          const isStopButtonVisible = !!document.querySelector('${selectors.streamingIndicator}');
          const isSendButtonEnabled = (() => {
            const btn = document.querySelector('${selectors.sendButton}');
            return btn && 
                   !btn.disabled && 
                   btn.getAttribute('aria-disabled') !== 'true' &&
                   !(btn.className && typeof btn.className === 'string' && btn.className.includes('disabled'));
          })();

          if (isStopButtonVisible) {
             window.__sawStopButton = true;
          }
          
          if (!isSendButtonEnabled) {
             window.__sawSendButtonDisabled = true;
          }

          // If we saw the stop button and now it's gone, or the send button disabled and re-enabled
          if (hasStarted && !completionSent) {
            if ((window.__sawStopButton && !isStopButtonVisible) || (window.__sawSendButtonDisabled && isSendButtonEnabled)) {
              // Wait 1.5s for any final text to trickle into the DOM
              setTimeout(() => {
                if (!completionSent) {
                  console.log('[Observer] Completion triggered by UI button state change.');
                  sendCompletion();
                }
              }, 1500);
            }
          }

          const allNodes = document.querySelectorAll('${selectors.responseArea}');
          if (allNodes.length === 0) return;
          
          const node = allNodes[allNodes.length - 1];
          if (!node) return;
          
          // If a new node appeared, reset tracking
          if (allNodes.length - 1 > currentNodeIndex) {
            currentNodeIndex = allNodes.length - 1;
            lastText = '';
            // Do NOT set hasStarted = true here. Wait for actual text to avoid race conditions.
          }
          
          const currentText = convertToMarkdown(node).trim();
          
          if (currentText !== lastText) {
            if (!hasStarted && currentText.length > 0) {
              hasStarted = true;
              console.log('[Observer] Streaming started! (first text chunk arrived)');
            }
            
            lastText = currentText;
            
            if (currentText.length > 0) {
              window.postMessage({ type: '__copilot_sync', data: currentText }, '*');
              resetStabilityTimer();
            }
          }
        });

        // Observe the entire body
        window.__copilotObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['class', 'disabled', 'aria-disabled']
        });
        
        console.log('[Observer] MutationObserver attached to document.body');
      })();
    `);

    console.log(`[BrowserController] MutationObserver attached.`);
  }

  /**
   * Inject a screenshot image AND text prompt into the provider's chat, then submit.
   * 
   * Strategy: Convert base64 to a File/Blob in the page context, then use
   * DataTransfer to simulate a paste event on the textarea. This works in
   * hidden BrowserWindows where native clipboard.paste() is ignored by
   * ChatGPT's trusted-event checks.
   * 
   * Fallback: If DataTransfer paste fails, try the hidden <input type="file">.
   * 
   * @param {string} provider - The provider name (e.g. 'chatgpt')
   * @param {string} promptString - The user's text message
   * @param {string} imageBase64 - The screenshot as a base64 data URL (data:image/png;base64,...)
   */
  async injectImageAndSubmit(provider, promptString, imageBase64) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    const selectors = selectorManager.getSelectors(provider);

    console.log(`[BrowserController] Injecting screenshot + prompt into ${provider}...`);

    // Step 1: Inject the image via file input or paste event
    const imageInjected = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          const base64 = ${JSON.stringify(imageBase64)};
          
          // Convert base64 data URL to Blob using atob (avoids CSP fetch issues)
          const parts = base64.split(',');
          const mime = parts[0].match(/:(.*?);/)[1];
          const raw = atob(parts[1]);
          const arr = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
          const blob = new Blob([arr], { type: mime });
          const file = new File([blob], 'screenshot.png', { type: 'image/png', lastModified: Date.now() });
          
          console.log('[Injected] Created File from base64:', file.size, 'bytes, type:', file.type);
          
          // Strategy 1: Use ChatGPT's specific #upload-photos input
          let fileInput = document.querySelector('#upload-photos') 
            || document.querySelector('[data-testid="upload-photos-input"]')
            || document.querySelector('input[type="file"][accept="image/*"]');
          
          if (fileInput) {
            console.log('[Injected] Found image file input:', fileInput.id || fileInput.className);
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Injected] Strategy 1: File set on #upload-photos via DataTransfer');
            return 'file-input-photos';
          }
          
          // Strategy 2: Any file input
          fileInput = document.querySelector('input[type="file"]');
          if (fileInput) {
            console.log('[Injected] Found generic file input');
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Injected] Strategy 2: File set on generic input[type=file]');
            return 'file-input-generic';
          }
          
          // Strategy 3: Click the "Add files" button to open the file picker, 
          // then intercept with the file
          const addFilesBtn = document.querySelector('button[aria-label="Add files and more"]')
            || document.querySelector('.composer-btn');
          if (addFilesBtn) {
            console.log('[Injected] Strategy 3: Clicking add files button...');
            addFilesBtn.click();
            // Wait for file input to appear
            await new Promise(r => setTimeout(r, 500));
            fileInput = document.querySelector('#upload-photos') 
              || document.querySelector('input[type="file"][accept="image/*"]')
              || document.querySelector('input[type="file"]');
            if (fileInput) {
              const dt = new DataTransfer();
              dt.items.add(file);
              fileInput.files = dt.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[Injected] Strategy 3: File set after clicking add-files button');
              return 'file-input-after-click';
            }
          }

          console.error('[Injected] All strategies failed. No file input found.');
          console.error('[Injected] Available inputs:', document.querySelectorAll('input').length);
          console.error('[Injected] Available file inputs:', document.querySelectorAll('input[type="file"]').length);
          return null;
        } catch (err) {
          console.error('[Injected] Image injection error:', err.message, err.stack);
          return 'error:' + err.message;
        }
      })();
    `);

    console.log(`[BrowserController] Image injection result: ${imageInjected}`);

    if (!imageInjected || (typeof imageInjected === 'string' && imageInjected.startsWith('error:'))) {
      console.warn(`[BrowserController] Image injection failed (${imageInjected}), falling back to text-only.`);
      return this.injectAndSubmit(provider, promptString);
    }

    // Step 2: Wait for the image to appear in the upload preview
    const uploadDetected = await this._waitForImageUpload(win, 10000);
    console.log(`[BrowserController] Upload preview detected: ${uploadDetected}`);

    // Step 3: Wait briefly for image upload processing
    console.log(`[BrowserController] Waiting 8s for image upload to process...`);
    await this._sleep(8000);

    // Step 4: Focus textarea and type text using native keyboard events
    // This is the SAME mechanism that works for text-only injectAndSubmit
    await win.webContents.executeJavaScript(`
      (function() {
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        if (textarea) {
          textarea.focus();
          textarea.click();
          // Move cursor to end
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(textarea);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          console.log('[Injected] Textarea focused and cursor at end for native typing.');
        }
      })();
    `);
    await this._sleep(300);

    // Use Electron's native insertText which triggers proper React input events
    // This is the EXACT same method used in injectAndSubmit for text-only (which works!)
    await win.webContents.insertText(promptString);
    console.log(`[BrowserController] Text typed via native insertText.`);
    
    // Brief delay to let React process
    await this._sleep(500);

    // Step 5: Submit via native Enter key (same as text-only flow)
    console.log(`[BrowserController] Submitting via native Enter key...`);
    await win.webContents.executeJavaScript(`
      (function() {
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        if (textarea) textarea.focus();
      })();
    `);
    await this._sleep(200);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    await this._sleep(50);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    
    // Wait 2s then check if prompt was actually submitted (page navigates or button changes)
    await this._sleep(2000);
    
    // Verify submission - check if a new assistant message appeared or URL changed
    const submitted = await win.webContents.executeJavaScript(`
      (function() {
        // Check if the send button is now gone (replaced by stop button) - means response is generating
        const sendBtn = document.querySelector('[data-testid="send-button"]');
        const stopBtn = document.querySelector('[data-testid="stop-button"]') 
          || document.querySelector('button[aria-label="Stop generating"]')
          || document.querySelector('button[aria-label="Stop"]');
        const textarea = document.querySelector('#prompt-textarea');
        const textareaEmpty = textarea && textarea.textContent.trim().length === 0;
        
        console.log('[Injected] Post-submit check: sendBtn=' + !!sendBtn + ' stopBtn=' + !!stopBtn + ' textareaEmpty=' + textareaEmpty);
        return { sendBtn: !!sendBtn, stopBtn: !!stopBtn, textareaEmpty };
      })();
    `);
    console.log(`[BrowserController] Post-submit check: ${JSON.stringify(submitted)}`);
    
    // If not submitted (textarea still has text, no stop button), try clicking send button directly
    if (submitted && !submitted.stopBtn && !submitted.textareaEmpty) {
      console.log(`[BrowserController] Enter key didn't submit. Trying direct button click...`);
      await win.webContents.executeJavaScript(`
        (function() {
          // Find ANY button that could be the send/submit button
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            const testid = btn.getAttribute('data-testid') || '';
            const aria = btn.getAttribute('aria-label') || '';
            if (testid.includes('send') || aria.includes('Send')) {
              btn.disabled = false;
              btn.click();
              console.log('[Injected] Clicked send button:', testid || aria);
              return;
            }
          }
          // Last resort: find the submit form
          const form = document.querySelector('form');
          if (form) {
            form.requestSubmit();
            console.log('[Injected] Called form.requestSubmit()');
          }
        })();
      `);
    }
    
    console.log(`[BrowserController] Screenshot + prompt injection complete.`);
  }

  /**
   * Inject generic files and submit prompt
   */
  async injectFilesAndSubmit(provider, promptString, files) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    const selectors = selectorManager.getSelectors(provider);

    console.log(`[BrowserController] Injecting ${files.length} files + prompt into ${provider}...`);

    // Step 1: Inject files via input[type="file"]
    const filesInjected = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          const files = ${JSON.stringify(files)};
          
          // Find generic file input (usually the one without accept="image/*")
          const fileInput = document.querySelector('input[type="file"]:not([accept="image/*"])') 
                         || document.querySelector('input[type="file"]');
          
          if (!fileInput) {
            console.error('[Injected] Generic file input not found');
            return null;
          }

          const dt = new DataTransfer();
          for (const f of files) {
            // Convert base64 back to Blob/File
            const raw = atob(f.data);
            const arr = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
            const blob = new Blob([arr], { type: f.type });
            const file = new File([blob], f.name, { type: f.type, lastModified: Date.now() });
            dt.items.add(file);
          }

          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Injected] Files set on input[type=file]');
          return 'success';
        } catch (err) {
          console.error('[Injected] File injection error:', err.message);
          return 'error:' + err.message;
        }
      })();
    `);

    console.log(`[BrowserController] File injection result: ${filesInjected}`);

    if (!filesInjected || (typeof filesInjected === 'string' && filesInjected.startsWith('error:'))) {
      console.warn(`[BrowserController] File injection failed, falling back to text-only.`);
      return this.injectAndSubmit(provider, promptString);
    }

    // Step 2: Wait briefly and check send button enabled (indicates upload process complete)
    console.log(`[BrowserController] Waiting for file upload and readiness...`);
    await this._sleep(3000);
    const ready = await this._waitForSendEnabled(win, selectors, 45000);
    console.log(`[BrowserController] Provider readiness: ${ready}`);

    // Step 3: Focus textarea and type prompt
    await win.webContents.executeJavaScript(`
      (function() {
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        if (textarea) {
          textarea.focus();
          textarea.click();
          // Move cursor to end
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(textarea);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      })();
    `);
    await this._sleep(300);

    await win.webContents.insertText(promptString);
    console.log(`[BrowserController] Text typed.`);
    await this._sleep(500);

    // Step 4: Submit via Return key
    console.log(`[BrowserController] Submitting...`);
    await win.webContents.executeJavaScript(`
      (function() {
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        if (textarea) textarea.focus();
      })();
    `);
    await this._sleep(200);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    await this._sleep(50);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

    // Verify submission
    await this._sleep(2000);
    const submitted = await win.webContents.executeJavaScript(`
      (function() {
        const sendBtn = document.querySelector('[data-testid="send-button"]');
        const stopBtn = document.querySelector('[data-testid="stop-button"]') 
          || document.querySelector('button[aria-label="Stop generating"]')
          || document.querySelector('button[aria-label="Stop"]');
        const textarea = document.querySelector('#prompt-textarea');
        const textareaEmpty = textarea && textarea.textContent.trim().length === 0;
        return { sendBtn: !!sendBtn, stopBtn: !!stopBtn, textareaEmpty };
      })();
    `);
    console.log(`[BrowserController] Post-submit check: ${JSON.stringify(submitted)}`);

    if (submitted && !submitted.stopBtn && !submitted.textareaEmpty) {
      console.log(`[BrowserController] Trying direct button click...`);
      await win.webContents.executeJavaScript(`
        (function() {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            const testid = btn.getAttribute('data-testid') || '';
            const aria = btn.getAttribute('aria-label') || '';
            if (testid.includes('send') || aria.includes('Send')) {
              btn.disabled = false;
              btn.click();
              return;
            }
          }
        })();
      `);
    }
  }

  /**
   * Wait for ChatGPT to show the image upload preview
   */
  async _waitForImageUpload(win, timeoutMs) {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const imageDetected = await win.webContents.executeJavaScript(`
          (function() {
            const imagePreview = document.querySelector('[data-testid="image-preview"]') 
              || document.querySelector('.image-preview-container')
              || document.querySelector('[class*="attachment"]')
              || document.querySelector('[class*="upload"]')
              || document.querySelector('img[src*="blob:"]')
              || document.querySelector('[data-testid="file-thumbnail"]');
            return !!imagePreview;
          })();
        `);

        if (imageDetected) {
          console.log(`[BrowserController] Image upload detected in ChatGPT.`);
          return true;
        }
      } catch (e) {
        // Page might be navigating, continue polling
      }

      await this._sleep(pollInterval);
    }

    console.log(`[BrowserController] Image upload detection timed out, proceeding anyway.`);
    return false;
  }

  /**
   * Wait for the send button to become enabled (not disabled/aria-disabled)
   * This indicates ChatGPT has finished processing the image upload
   */
  async _waitForSendEnabled(win, selectors, timeoutMs) {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await win.webContents.executeJavaScript(`
          (function() {
            // Try multiple send button selectors
            const btn = document.querySelector('${selectors.sendButton}')
              || document.querySelector('[data-testid="send-button"]')
              || document.querySelector('button[aria-label="Send prompt"]')
              || document.querySelector('button[aria-label="Send"]');
            
            if (!btn) return { found: false, disabled: true, info: 'no button found' };
            
            const isDisabled = btn.disabled 
              || btn.getAttribute('aria-disabled') === 'true'
              || btn.classList.contains('disabled');
            
            return { 
              found: true, 
              disabled: isDisabled, 
              info: 'tag=' + btn.tagName + ' disabled=' + btn.disabled + ' aria=' + btn.getAttribute('aria-disabled')
            };
          })();
        `);

        console.log(`[BrowserController] Send button status: ${JSON.stringify(status)}`);

        if (status.found && !status.disabled) {
          console.log(`[BrowserController] Send button is ENABLED and ready!`);
          return true;
        }
      } catch (e) {
        // Page might be navigating
      }

      await this._sleep(pollInterval);
    }

    console.log(`[BrowserController] Timed out waiting for send button to enable, proceeding anyway.`);
    return false;
  }

  /**
   * Click the send button using multiple strategies
   */
  async _clickSendButton(win, selectors) {
    return await win.webContents.executeJavaScript(`
      (function() {
        // Strategy 1: Primary selector
        let btn = document.querySelector('${selectors.sendButton}');
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          console.log('[Injected] Clicking send button (primary selector).');
          btn.click();
          return true;
        }

        // Strategy 2: data-testid
        btn = document.querySelector('[data-testid="send-button"]');
        if (btn && !btn.disabled) {
          console.log('[Injected] Clicking send button (data-testid).');
          btn.click();
          return true;
        }

        // Strategy 3: aria-label
        btn = document.querySelector('button[aria-label="Send prompt"]')
           || document.querySelector('button[aria-label="Send"]');
        if (btn && !btn.disabled) {
          console.log('[Injected] Clicking send button (aria-label).');
          btn.click();
          return true;
        }

        // Strategy 4: Find button with send SVG icon near the textarea
        const allButtons = document.querySelectorAll('button');
        for (const b of allButtons) {
          const svg = b.querySelector('svg');
          if (svg && !b.disabled && b.closest('form, [class*="composer"], [class*="input"]')) {
            const path = svg.querySelector('path');
            if (path) {
              console.log('[Injected] Clicking likely send button (SVG near input).');
              b.click();
              return true;
            }
          }
        }

        console.log('[Injected] No clickable send button found.');
        return false;
      })();
    `);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract all conversation titles and URLs from ChatGPT's sidebar
   * @param {string} provider
   * @returns {Promise<Array<{title: string, url: string}>>}
   */
  async getConversationList(provider) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) return [];

    const selectors = selectorManager.getSelectors(provider);

    return await win.webContents.executeJavaScript(`
      (function() {
        const links = document.querySelectorAll('${selectors.sidebarChatList}');
        const conversations = [];
        links.forEach(link => {
          const titleEl = link.querySelector('${selectors.chatTitle}');
          const title = titleEl ? titleEl.innerText.trim() : link.innerText.trim();
          const href = link.getAttribute('href') || '';
          if (title && href) {
            conversations.push({ title, url: href });
          }
        });
        return conversations;
      })();
    `);
  }

  /**
   * Navigate the hidden browser to a specific conversation URL
   * @param {string} provider
   * @param {string} conversationUrl - e.g. '/c/6a27c9aa-...'
   */
  async navigateToConversation(provider, conversationUrl) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden browser not ready');

    const caps = providerCapabilities.getCapabilities(provider);
    const baseUrl = caps ? caps.baseUrl : 'https://chatgpt.com';
    const fullUrl = conversationUrl.startsWith('http') ? conversationUrl : baseUrl + conversationUrl;

    console.log(`[BrowserController] Navigating to conversation: ${fullUrl}`);
    await win.webContents.loadURL(fullUrl);
    await this._sleep(30000); // Let it load
    console.log(`[BrowserController] Conversation loaded.`);
  }
}

module.exports = new BrowserController();

