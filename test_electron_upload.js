const fs = require('fs');
const path = require('path');
const http = require('http');

const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

function requestDebugEval(jsCode) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:9876/debug/eval?api_key=${apiKey}&js=${encodeURIComponent(jsCode)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve(parsed.result);
          } else {
            reject(new Error(parsed.error || 'Request not OK'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  try {
    const readmePath = path.join(__dirname, 'README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    
    console.log('1. Starting README.md upload to ChatGPT...');
    
    // Prepare the upload JS payload
    const uploadScript = `
      (async function() {
        try {
          const content = ${JSON.stringify(readmeContent)};
          const blob = new Blob([content], { type: 'text/markdown' });
          const file = new File([blob], 'README.md', { type: 'text/markdown', lastModified: Date.now() });

          // Find generic file input (usually the one without accept="image/*")
          const fileInput = document.querySelector('input[type="file"]:not([accept="image/*"])') 
                         || document.querySelector('input[type="file"]');
          
          if (!fileInput) {
            return 'error:No file input found';
          }

          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          return 'uploaded';
        } catch (e) {
          return 'error:' + e.message;
        }
      })()
    `;

    const uploadRes = await requestDebugEval(uploadScript);
    console.log('Upload trigger response:', uploadRes);
    if (uploadRes.startsWith('error:')) {
      throw new Error(uploadRes);
    }

    console.log('\n2. Waiting for file to upload and ChatGPT to finish analysis...');
    
    // Poll readiness (checking textarea, spinners, and send button)
    const readinessScript = `
      (() => {
        // 1. Check if textarea is active and editable
        const textarea = document.querySelector('#prompt-textarea');
        if (!textarea) return 'no_textarea';
        if (textarea.disabled || textarea.getAttribute('aria-disabled') === 'true') {
          return 'textarea_disabled';
        }

        // 2. Check if any progress spinners or upload indicators are visible
        const spinners = document.querySelectorAll('div[role="progressbar"], .spinner, .upload-spinner, .progressbar');
        for (const spinner of spinners) {
          const rect = spinner.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return 'spinners_visible';
          }
        }

        // 3. Check attachments specifically
        const attachments = document.querySelectorAll('[data-testid="attachment-item"], .file-attachment');
        for (const att of attachments) {
          const progress = att.querySelector('div[role="progressbar"], .spinner, .upload-spinner, .progressbar');
          if (progress) return 'attachment_spinner_visible';
        }

        // 4. Check for any "Analyzing", "indexing", or "uploading" labels in the DOM
        const bodyText = document.body.innerText || "";
        const lowerText = bodyText.toLowerCase();
        if (lowerText.includes("analyzing") || lowerText.includes("indexing") || lowerText.includes("uploading")) {
          return 'analyzing_or_indexing';
        }

        // 5. Check if send button is present and enabled
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        if (!sendBtn) return 'no_send_button';
        if (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
          return 'send_button_disabled';
        }

        return 'ready';
      })()
    `;

    while (true) {
      const state = await requestDebugEval(readinessScript);
      console.log('   Readiness status:', state);
      if (state === 'ready') {
        break;
      }
      await sleep(2000);
    }

    console.log('\n3. ChatGPT is ready! Submitting prompt...');
    
    const submitScript = `
      (async function() {
        const textarea = document.querySelector('#prompt-textarea');
        if (textarea) {
          textarea.focus();
          document.execCommand('insertText', false, 'ANALYSE IT AND TELL ME WHAT IS IT ABOUT');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          await new Promise(r => setTimeout(r, 600));
          
          const sendBtn = document.querySelector('button[data-testid="send-button"]');
          if (sendBtn) {
            sendBtn.click();
            return 'submitted';
          }
        }
        return 'failed_to_submit';
      })()
    `;

    const submitRes = await requestDebugEval(submitScript);
    console.log('Submission response:', submitRes);
    if (submitRes !== 'submitted') {
      throw new Error('Failed to submit prompt');
    }

    console.log('\n4. Streaming response from ChatGPT...');
    let lastText = '';
    let stableCount = 0;
    
    const streamScript = `
      (() => {
        const elements = document.querySelectorAll('.markdown.prose');
        const lastEl = elements[elements.length - 1];
        if (!lastEl) return '';
        
        // Also check if generating has finished
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        const isSendEnabled = sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true';
        
        return {
          text: lastEl.innerText,
          isFinished: isSendEnabled
        };
      })()
    `;

    while (true) {
      const res = await requestDebugEval(streamScript);
      if (res && res.text) {
        if (res.text !== lastText) {
          const delta = res.text.slice(lastText.length);
          process.stdout.write(delta);
          lastText = res.text;
          stableCount = 0;
        } else if (res.isFinished) {
          stableCount++;
          // Require it to be stable for 3 checks to be sure it's fully done
          if (stableCount >= 3) {
            break;
          }
        }
      }
      await sleep(1000);
    }

    console.log('\n\n--- Stream Completed Successfully ---');

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
