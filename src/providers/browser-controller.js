const { nativeImage, clipboard } = require('electron');
const selectorManager = require('./selector-manager');
const hiddenBrowserManager = require('./hidden-browser-manager');
const eventBus = require('../main/event-bus');
const stateManager = require('../main/state-manager');

/**
 * Browser Controller
 * Executes specific JS commands in the hidden BrowserWindow to manipulate
 * the DOM (inject prompts, attach observers).
 */
class BrowserController {
  
  async injectAndSubmit(provider, promptString) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    const selectors = selectorManager.getSelectors(provider);
    
    // Safely escape the string for injection
    const safePrompt = JSON.stringify(promptString);

    console.log(`[BrowserController] Injecting prompt into ${provider}...`);

    await win.webContents.executeJavaScript(`
      (function() {
        console.log('[Injected] Looking for textarea: ${selectors.textarea}');
        
        // Custom logic for Google Search: click "AI Mode" button if present
        if ('${provider}' === 'google') {
          try {
            const aiModeElements = Array.from(document.querySelectorAll('button, div, span, a')).filter(el => {
              const text = el.textContent.trim();
              return text.toLowerCase() === 'ai mode' || text.toLowerCase().includes('ai mode');
            });
            if (aiModeElements.length > 0) {
              console.log('[Injected] Found AI Mode element on Google, clicking...');
              aiModeElements[0].click();
            }
          } catch (e) {
            console.error('[Injected] Error clicking AI Mode on Google:', e.message);
          }
        }

        const textarea = document.querySelector('${selectors.textarea}');
        
        if (!textarea) {
          console.error('[Injected] Textarea not found!');
          // Try contenteditable div (ChatGPT uses this)
          const contentEditable = document.querySelector('#prompt-textarea');
          if (contentEditable) {
            console.log('[Injected] Found contenteditable prompt-textarea');
            contentEditable.focus();
            contentEditable.textContent = ${safePrompt};
            contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            console.error('[Injected] No input element found at all!');
            if (window.__aiCopilot) window.__aiCopilot.sendError('Textarea not found');
            return false;
          }
        } else {
          console.log('[Injected] Found textarea, setting value...');
          // Handle both <textarea> and contenteditable elements
          if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
            textarea.value = ${safePrompt};
          } else {
            textarea.textContent = ${safePrompt};
          }
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Wait briefly, then click send
        setTimeout(() => {
          console.log('[Injected] Looking for send button: ${selectors.sendButton}');
          const sendBtn = document.querySelector('${selectors.sendButton}');
          if (sendBtn) {
            console.log('[Injected] Found send button, clicking...');
            sendBtn.click();
          } else {
            console.log('[Injected] Send button not found, trying Enter key...');
            // Fallback: press Enter
            const target = document.querySelector('${selectors.textarea}') || document.querySelector('#prompt-textarea');
            if (target) {
              target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
          }
        }, 500);
        
        return true;
      })();
    `);
    
    console.log(`[BrowserController] Prompt injection complete.`);
  }

  async attachStreamObserver(provider) {
    const win = hiddenBrowserManager.getWindow(provider);
    if (!win) throw new Error('Hidden window not ready');

    const selectors = selectorManager.getSelectors(provider);

    console.log(`[BrowserController] Attaching MutationObserver for ${provider}...`);

    await win.webContents.executeJavaScript(`
      (function() {
        console.log('[Observer] Setting up MutationObserver...');

        if (window.__copilotObserver) {
          window.__copilotObserver.disconnect();
          console.log('[Observer] Disconnected previous observer.');
        }
        if (window.__copilotStabilityTimer) {
          clearTimeout(window.__copilotStabilityTimer);
        }
        if (window.__copilotInactivityTimer) {
          clearTimeout(window.__copilotInactivityTimer);
        }

        // Snapshot: capture the current text of the LAST response node at attach time.
        // Anything beyond this text is "new" streaming content.
        const allNodesAtStart = document.querySelectorAll('${selectors.responseArea}');
        const lastNodeAtStart = allNodesAtStart.length > 0 ? allNodesAtStart[allNodesAtStart.length - 1] : null;
        const snapshotText = lastNodeAtStart ? convertToMarkdown(lastNodeAtStart).trim() : '';
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

        function resetInactivityTimer() {
          if (window.__copilotInactivityTimer) {
            clearTimeout(window.__copilotInactivityTimer);
          }
          if (hasStarted && !completionSent) {
            window.__copilotInactivityTimer = setTimeout(() => {
              console.log('[Observer] Inactivity timer triggered completion (text stopped changing for 3.5s).');
              sendCompletion();
            }, 3500); // 3.5s of no text changes
          }
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
          if (window.__copilotInactivityTimer) {
            clearTimeout(window.__copilotInactivityTimer);
          }
        }
        
        function convertToMarkdown(n) {
          let md = '';
          for (const child of n.childNodes) {
            if (child.nodeType === 3) { // Text node
              md += child.textContent;
            } else if (child.nodeType === 1) { // Element node
              const tag = child.tagName.toLowerCase();
              if (tag === 'script' || tag === 'style' || tag === 'button' || tag === 'input' || tag === 'textarea') {
                continue;
              }
              if (child.style && (child.style.display === 'none' || child.style.visibility === 'hidden')) {
                continue;
              }
              if (child.getAttribute && child.getAttribute('aria-hidden') === 'true') {
                continue;
              }
              const id = child.id || '';
              const className = typeof child.className === 'string' ? child.className : '';
              if (id.includes('fbproxy') || id.includes('shrproxy') || 
                  className.includes('YOTKvb') || className.includes('WaKIwf')) {
                continue;
              }
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
          const allNodes = document.querySelectorAll('${selectors.responseArea}');
          console.log('[DEBUG-DOM] observer fired. allNodes count: ' + allNodes.length + '. Body innerText: ' + document.body.innerText.substring(0, 1000).split('\\n').join(' '));
          if (allNodes.length === 0) {
            const alternatives = [];
            document.querySelectorAll('div, section, article').forEach(el => {
              const className = el.className || '';
              if (className.includes('font-') || className.includes('message') || className.includes('prose') || className.includes('chat')) {
                alternatives.push(el);
              }
            });
            if (alternatives.length > 0) {
              console.log('[DEBUG-DOM] No match for ${selectors.responseArea}. Found alternative containers:');
              alternatives.forEach((alt, idx) => {
                if (idx < 15) {
                  console.log('[DEBUG-DOM] tag=' + alt.tagName + ' class="' + alt.className + '" textPreview="' + alt.textContent.trim().substring(0, 80).split('\\n').join(' ') + '"');
                }
              });
            }
            return;
          }
          
          const node = allNodes[allNodes.length - 1];
          if (!node) return;
          
          // If a new node appeared, reset tracking
          if (allNodes.length - 1 > currentNodeIndex) {
            currentNodeIndex = allNodes.length - 1;
            lastText = '';
            // Do NOT set hasStarted = true here. Wait for actual text to avoid race conditions.
          }
          
          const currentText = convertToMarkdown(node).trim();
          
          if (currentNodeIndex >= snapshotNodeCount && currentText !== lastText) {
            if (!hasStarted && currentText.length > 0) {
              hasStarted = true;
              console.log('[Observer] Streaming started! (first text chunk arrived)');
              resetInactivityTimer();
            }
            
            lastText = currentText;
            
            if (currentText.length > 0) {
              window.postMessage({ type: '__copilot_sync', data: currentText }, '*');
              resetStabilityTimer();
              resetInactivityTimer();
            }
          }

          // Check if streaming finished via button states
          const isStopButtonVisible = !!document.querySelector('${selectors.streamingIndicator}');
          const isSendButtonEnabled = (() => {
            const btn = document.querySelector('${selectors.sendButton}');
            return btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
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
        });

        // Observe the entire body
        window.__copilotObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
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
          
          if ('${provider}' === 'google') {
            console.log('[Injected] Google Search image upload starting...');
            // Check if there is a "More input options" button (conversational layout)
            const moreOptionsBtn = document.querySelector('button[aria-label="More input options"], button.hhGtFb');
            if (moreOptionsBtn) {
              console.log('[Injected] Found More input options button, clicking...');
              moreOptionsBtn.click();
              // Wait for file input to render
              for (let i = 0; i < 15; i++) {
                const fileInput = document.querySelector('input[type="file"]');
                if (fileInput) break;
                await new Promise(r => setTimeout(r, 100));
              }
            } else {
              // Fallback to standard Lens camera button
              const lensBtn = document.querySelector('div[aria-label="Search by image"], div[jscontroller="Ur7rZe"], div.n3nFBe, div.etxtjc');
              if (lensBtn) {
                console.log('[Injected] Found Lens camera button, clicking...');
                lensBtn.click();
                // Wait for file input to render
                for (let i = 0; i < 15; i++) {
                  const fileInput = document.querySelector('input[type="file"]');
                  if (fileInput) break;
                  await new Promise(r => setTimeout(r, 100));
                }
              }
            }
          }

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
            console.log('[Injected] Strategy 1: File set via DataTransfer');
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

    if (provider === 'google') {
      console.log(`[BrowserController] Google Search AI Mode: Waiting to see if page navigates after upload...`);
      const startUrl = win.webContents.getURL();
      let navigated = false;
      for (let i = 0; i < 6; i++) { // Up to 3 seconds
        await this._sleep(500);
        if (win.webContents.getURL() !== startUrl) {
          navigated = true;
          break;
        }
      }
      
      if (navigated) {
        console.log(`[BrowserController] Google navigated. New URL: ${win.webContents.getURL()}`);
        // Wait 3s to let the new page load
        await this._sleep(3000);

        // Now inject the text prompt if one was provided
        if (promptString && promptString.trim().length > 0) {
          console.log(`[BrowserController] Injecting prompt text "${promptString}" into visual search results...`);
          
          // Find the input element on the search results page
          const textInjected = await win.webContents.executeJavaScript(`
            (function() {
              const input = document.querySelector('input[placeholder*="search" i], textarea[placeholder*="search" i], input[aria-label*="search" i], textarea[aria-label*="search" i], input[name="q"], textarea[name="q"]');
              if (input) {
                input.focus();
                input.click();
                // Clear current value if any
                if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                  input.value = '';
                } else {
                  input.textContent = '';
                }
                input.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[Injected] Google visual search input focused and ready');
                return true;
              }
              console.error('[Injected] Could not find search input on Google visual search results page!');
              return false;
            })();
          `);

          if (textInjected) {
            // Native typing
            await win.webContents.insertText(promptString);
            await this._sleep(500);

            // Submit by pressing Enter key
            console.log(`[BrowserController] Submitting visual search text prompt via native Enter...`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
            win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
            await this._sleep(50);
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
          }
        }
      } else {
        console.log(`[BrowserController] Google did not navigate (inline upload flow). Injecting prompt text into chat...`);
        // Wait a few seconds for image processing in the current chat view
        const delays = stateManager.get('screenshotDelays') || {};
        const googleDelay = (delays.google !== undefined ? delays.google : 4) * 1000;
        console.log(`[BrowserController] Waiting ${googleDelay}ms for Google image upload to process...`);
        await this._sleep(googleDelay);

        // Focus search box and insert text prompt
        await win.webContents.executeJavaScript(`
          (function() {
            const textarea = document.querySelector('${selectors.textarea}');
            if (textarea) {
              textarea.focus();
              textarea.click();
              console.log('[Injected] Inline textarea focused');
            }
          })();
        `);
        await this._sleep(300);

        if (promptString && promptString.trim().length > 0) {
          await win.webContents.insertText(promptString);
          await this._sleep(500);
        }

        // Submit via native Enter key (which is extremely reliable!)
        console.log(`[BrowserController] Submitting inline search prompt via native Enter...`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        await this._sleep(50);
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

        // Fallback: click send button if Enter key didn't submit
        await this._sleep(1500);
        await win.webContents.executeJavaScript(`
          (function() {
            const sendBtn = document.querySelector('${selectors.sendButton}');
            if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
              console.log('[Injected] Fallback: Clicking send button...');
              sendBtn.click();
            }
          })();
        `);
      }
      
      console.log(`[BrowserController] Google screenshot + prompt injection complete.`);
      return;
    }

    // Step 2: Wait for the image to appear in the upload preview
    const uploadDetected = await this._waitForImageUpload(win, 10000);
    console.log(`[BrowserController] Upload preview detected: ${uploadDetected}`);

    // Step 3: Wait briefly for image upload processing
    const delays = stateManager.get('screenshotDelays') || {};
    const providerDelay = (delays[provider] !== undefined ? delays[provider] : 8) * 1000;
    console.log(`[BrowserController] Waiting ${providerDelay}ms for image upload to process...`);
    await this._sleep(providerDelay);

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

    const baseUrl = provider === 'chatgpt' ? 'https://chatgpt.com' : 'https://gemini.google.com';
    const fullUrl = conversationUrl.startsWith('http') ? conversationUrl : baseUrl + conversationUrl;

    console.log(`[BrowserController] Navigating to conversation: ${fullUrl}`);
    await win.webContents.loadURL(fullUrl);
    await this._sleep(30000); // Let it load
    console.log(`[BrowserController] Conversation loaded.`);
  }
}

module.exports = new BrowserController();

