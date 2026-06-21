const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  try {
    // 1. Submit a message "say hello in 5 words" to trigger streaming
    const target = document.querySelector('textarea');
    if (!target) return { error: 'No textarea found' };

    target.focus();
    target.select();
    document.execCommand('insertText', false, 'say hello in exactly 5 words');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 600));

    // Find the send button
    let sendBtn = document.querySelector('div[role="button"].ds-button--primary');
    if (!sendBtn) {
      sendBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.className && b.className.includes('primary'));
    }

    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fallback
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    // Wait 500ms and capture the DOM state during streaming
    await new Promise(r => setTimeout(r, 800));

    // Look for stop button, active buttons, or elements that might indicate streaming
    const streamingButtons = Array.from(document.querySelectorAll('div[role="button"], button')).map(b => ({
      tag: b.tagName,
      class: b.className,
      text: b.innerText ? b.innerText.substring(0, 30) : '',
      ariaLabel: b.getAttribute('aria-label'),
      html: b.outerHTML.substring(0, 250)
    }));

    // Find all links for sidebar chat lists
    const links = Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
      href: a.getAttribute('href'),
      class: a.className,
      text: a.innerText ? a.innerText.substring(0, 40) : '',
      html: a.outerHTML.substring(0, 150)
    }));

    return { streamingButtons, links };
  } catch (err) {
    return { error: err.message, stack: err.stack };
  }
})()`;

const url = 'http://127.0.0.1:9876/debug/eval?api_key=' + apiKey + '&js=' + encodeURIComponent(jsCode);
http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch(e) {
      console.log('Raw response:', data);
    }
  });
}).on('error', (err) => console.error(err));
