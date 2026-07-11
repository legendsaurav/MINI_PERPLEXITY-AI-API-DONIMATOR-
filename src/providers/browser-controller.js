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
    const safePrompt = JSON.stringify(promptString);

    console.log(`[BrowserController] Injecting prompt into ${provider}...`);

    // 1. Wait for any active generation to finish (stop button gone)
    await win.webContents.executeJavaScript(`
      (async function() {
        const stopButtonSelector = '${selectors.stopButton || ''}';
        const streamingIndicatorSelector = '${selectors.streamingIndicator || ''}';
        for (let i = 0; i < 20; i++) {
          const stopBtn = stopButtonSelector ? document.querySelector(stopButtonSelector) : null;
          const indicator = streamingIndicatorSelector ? document.querySelector(streamingIndicatorSelector) : null;
          if (!stopBtn && !indicator) break;
          console.log('[Injected] Waiting for active generation to finish...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      })()
    `).catch(err => console.error('[BrowserController] Wait for active generation failed:', err.message));

    // 2. Set the input value and focus
    const needFallback = await win.webContents.executeJavaScript(`
      (async function() {
        const textareaSelector = '${selectors.textarea}';
        let textarea = document.querySelector(textareaSelector);
        
        if (!textarea) {
          const contentEditable = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
          if (contentEditable) {
            contentEditable.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${safePrompt});
            contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
            textarea = contentEditable;
          } else {
            console.error('[Injected] No input element found!');
            return false;
          }
        } else {
          textarea.focus();
          if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
            textarea.value = ${safePrompt};
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${safePrompt});
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        // Wait a brief moment for React state to update
        await new Promise(resolve => setTimeout(resolve, 500));

        const sendButtonSelector = '${selectors.sendButton}';
        const sendBtn = document.querySelector(sendButtonSelector);
        if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
          console.log('[Injected] Found active send button, clicking...');
          sendBtn.click();
          return false; // No fallback needed
        }
        
        console.log('[Injected] Send button not found or disabled. Requesting native Enter fallback.');
        if (textarea) textarea.focus();
        return true; // Request fallback
      })();
    `);

    // 2b. DeepSeek submission fix: its editor is a controlled textarea that ignores a
    // programmatic `.value =` — the send button stays effectively empty and submits
    // nothing. A real keystroke is required to register the text. Focus the input,
    // type a trailing SPACE (a genuine key event that flushes the injected text into
    // the editor's state and enables send), then press ENTER to submit.
    if (provider === 'deepseek') {
      console.log('[BrowserController] DeepSeek: applying native space+Enter submission.');
      await win.webContents.executeJavaScript(`
        (function(){
          const ta = document.querySelector('${selectors.textarea}');
          if (ta) { ta.focus();
            try { const end = (ta.value || '').length; ta.setSelectionRange(end, end); } catch(e){} }
        })();
      `).catch(() => {});
      win.webContents.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      // Trailing space — makes the controlled editor register the injected text.
      win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
      await new Promise(resolve => setTimeout(resolve, 400));
      // Enter to submit.
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      await new Promise(resolve => setTimeout(resolve, 50));
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      console.log('[BrowserController] Prompt injection complete (deepseek space+Enter).');
      return;
    }

    // 3. Trigger native Enter key if requested
    if (needFallback) {
      console.log(`[BrowserController] Triggering native Enter key fallback...`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      await new Promise(resolve => setTimeout(resolve, 50));
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

      // Failsafe: verify whether the prompt actually moved into the provider state.
      // If nothing changed after 2s, retry once with a more aggressive fallback.
      await new Promise(resolve => setTimeout(resolve, 2000));
      const submissionVerified = await win.webContents.executeJavaScript(`
        (function() {
          const textarea = document.querySelector('${selectors.textarea}') || document.querySelector('#prompt-textarea');
          const sendButtonSelector = '${selectors.sendButton}';
          const sendBtn = document.querySelector(sendButtonSelector);
          const stopButtonSelector = '${selectors.stopButton || ''}';
          const stopBtn = stopButtonSelector ? document.querySelector(stopButtonSelector) : null;
          const textareaText = textarea ? (textarea.value || textarea.textContent || '').trim() : '';
          const hasSubmittedState = !!stopBtn || !!(sendBtn && sendBtn.disabled);
          return { textareaText, hasSubmittedState, hasSendButton: !!sendBtn };
        })()
      `).catch(() => ({ textareaText: '', hasSubmittedState: false, hasSendButton: false }));

      if (!submissionVerified || !submissionVerified.textareaText || !submissionVerified.hasSubmittedState) {
        console.warn('[BrowserController] Submission did not appear to take effect. Trying a second fallback...');
        await win.webContents.executeJavaScript(`
          (function() {
            const textarea = document.querySelector('${selectors.textarea}') || document.querySelector('#prompt-textarea');
            if (textarea) {
              textarea.focus();
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
              const testid = btn.getAttribute('data-testid') || '';
              const aria = btn.getAttribute('aria-label') || '';
              if (testid.includes('send') || aria.includes('Send') || aria.includes('Submit')) {
                btn.disabled = false;
                btn.click();
                return true;
              }
            }
            const form = document.querySelector('form');
            if (form) {
              form.requestSubmit();
              return true;
            }
            return false;
          })()
        `).catch(() => false);
      }
    }

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
        if (window.__copilotPoll) {
          clearInterval(window.__copilotPoll);
        }
        if (window.__copilotStabilityTimer) {
          clearTimeout(window.__copilotStabilityTimer);
        }
        if (window.__copilotInactivityTimer) {
          clearTimeout(window.__copilotInactivityTimer);
        }

        window.__sawStopButton = false;
        window.__sawSendButtonDisabled = false;

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
              console.log('[Observer] Inactivity timer triggered completion (text stopped changing for 25s).');
              sendCompletion();
            }, 25000); // 25s of no text changes (large buffer to accommodate image analysis)
          }
        }

        function sendCompletion() {
          if (completionSent) return;
          completionSent = true;
          
          const finalNodes = document.querySelectorAll('${selectors.responseArea}');
          // Prefer the freshly-extracted node text; otherwise fall back to lastText,
          // which holds the last non-empty response text captured during streaming
          // (clean, selector-derived — not page chrome).
          const freshText = finalNodes.length > 0 ? convertToMarkdown(finalNodes[finalNodes.length - 1]).trim() : '';
          const finalText = freshText.length > 0 ? freshText : lastText;

          console.log('[Observer] Stream complete. Final text length:', finalText.length);
          window.postMessage({ type: '__copilot_complete', data: { fullText: finalText } }, '*');

          if (window.__copilotObserver) {
            window.__copilotObserver.disconnect();
          }
          if (window.__copilotPoll) {
            clearInterval(window.__copilotPoll);
            window.__copilotPoll = null;
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
                const href = child.getAttribute('href');
                if (href) {
                  md += '[' + convertToMarkdown(child) + '](' + href + ')';
                } else {
                  md += convertToMarkdown(child);
                }
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

        // The core per-tick logic. Driven by BOTH the MutationObserver AND a polling
        // interval below — some SPAs (e.g. DeepSeek) render responses in a tree the
        // observer never sees, so a timer-based fallback guarantees progress + completion.
        function processTick() {
          if ('${provider}' === 'chatgpt') {
            try {
              const preferenceBtns = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(b => {
                const txt = b.textContent.trim().toLowerCase();
                return txt === 'response 1' || txt === 'option 1' || txt === 'response a' ||
                       txt.includes('response 1') || txt.includes('option 1') || txt.includes('response a');
              });
              if (preferenceBtns.length > 0) {
                const btn = preferenceBtns[0];
                const now = Date.now();
                if (!window.__lastComparisonClick || now - window.__lastComparisonClick > 2000) {
                  window.__lastComparisonClick = now;
                  console.log('[Observer] Detected response comparison. Clicking to dismiss...', btn.textContent.trim());
                  btn.click();
                  return;
                }
              }
            } catch (e) {
              console.error('[Observer] Error in response comparison check:', e.message);
            }
          }

          const allNodes = document.querySelectorAll('${selectors.responseArea}');
          console.log('[DEBUG-DOM] observer fired. allNodes count: ' + allNodes.length + '. Body innerText: ' + document.body.innerText.substring(0, 1000).split('\\n').join(' '));

          // Extract the latest response text if the responseArea selector matches.
          // NOTE: we intentionally do NOT bail out when it matches nothing — button-state
          // completion detection below must still run so providers whose response selector
          // is stale (or whose text lands in the snapshot's own last node) can still finish.
          if (allNodes.length > 0) {
            const node = allNodes[allNodes.length - 1];
            if (node) {
              // If a brand-new response node appeared, advance tracking to it.
              if (allNodes.length - 1 > currentNodeIndex) {
                currentNodeIndex = allNodes.length - 1;
                lastText = '';
              }

              const currentText = convertToMarkdown(node).trim();

              // Accept text either from a new node (index past snapshot) OR from the
              // snapshot's own last node growing in place (currentText diverging from
              // the captured snapshotText) — the latter covers providers like Kimi that
              // update an existing node instead of appending one.
              const grewInPlace = currentNodeIndex === snapshotNodeCount - 1 &&
                                   currentText.length > snapshotText.length &&
                                   currentText !== snapshotText;

              if ((currentNodeIndex >= snapshotNodeCount || grewInPlace) && currentText !== lastText) {
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
        }

        window.__copilotObserver = new MutationObserver(processTick);

        // Observe documentElement (not body): some SPAs (e.g. DeepSeek) swap out
        // document.body after load, which would silently detach an observer bound
        // to the old body node. documentElement is stable for the page lifetime.
        window.__copilotObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true
        });

        // Polling fallback: MutationObserver misses responses rendered in shadow
        // DOM / detached trees (observed with DeepSeek). Re-run the same tick on a
        // timer so text capture and completion still happen. Cleared in sendCompletion.
        if (window.__copilotPoll) clearInterval(window.__copilotPoll);
        window.__copilotPoll = setInterval(processTick, 750);

        console.log('[Observer] MutationObserver + poll attached to document.documentElement');
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

    // Step 4: Inject prompt text directly into DOM and dispatch input event
    const safePrompt = JSON.stringify(promptString);
    const promptSet = await win.webContents.executeJavaScript(`
      (function() {
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        if (textarea) {
          console.log('[Injected] Setting textarea value directly in DOM...');
          if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
            textarea.value = ${safePrompt};
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            textarea.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${safePrompt});
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          console.log('[Injected] Text value set directly and input event dispatched.');
          return true;
        }
        console.error('[Injected] Textarea not found for text injection!');
        return false;
      })();
    `);
    console.log(`[BrowserController] Text injected directly into DOM: ${promptSet}`);
    
    // Brief delay to let React process
    await this._sleep(500);

    // Step 5: If the send button is already enabled, use it. Otherwise try Enter, then retry with the button.
    const sendReady = await this._waitForSendEnabled(win, selectors, 8000);
    console.log(`[BrowserController] Send button ready before submit: ${sendReady}`);

    if (sendReady) {
      console.log(`[BrowserController] Submitting via send button...`);
      const clicked = await this._clickSendButton(win, selectors);
      console.log(`[BrowserController] Send button click result: ${clicked}`);
    } else {
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
    }

    // Wait 2s then check if prompt was actually submitted (page navigates or button changes)
    await this._sleep(2000);
    
    const submitted = await win.webContents.executeJavaScript(`
      (function() {
        const sendBtn = document.querySelector('[data-testid="send-button"]');
        const stopBtn = document.querySelector('[data-testid="stop-button"]')
          || document.querySelector('button[aria-label="Stop generating"]')
          || document.querySelector('button[aria-label="Stop"]');
        const textarea = document.querySelector('#prompt-textarea') || document.querySelector('${selectors.textarea}');
        const textareaText = textarea ? (textarea.value || textarea.textContent || '').trim() : '';
        const textareaEmpty = !textareaText;
        console.log('[Injected] Post-submit check: sendBtn=' + !!sendBtn + ' stopBtn=' + !!stopBtn + ' textareaEmpty=' + textareaEmpty + ' textareaText=' + JSON.stringify(textareaText.slice(0, 80)));
        return { sendBtn: !!sendBtn, stopBtn: !!stopBtn, textareaEmpty, textareaText };
      })();
    `);
    console.log(`[BrowserController] Post-submit check: ${JSON.stringify(submitted)}`);
    
    if (submitted && !submitted.stopBtn && !submitted.textareaEmpty) {
      console.log(`[BrowserController] Submission did not appear to take effect. Retrying via direct button click...`);
      const clicked = await this._clickSendButton(win, selectors);
      console.log(`[BrowserController] Retry click result: ${clicked}`);
      await this._sleep(1500);
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

