const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  try {
    const target = document.querySelector('textarea');
    if (!target) return { error: 'No textarea found' };

    target.focus();
    target.select();
    document.execCommand('insertText', false, 'Explain quantum computing in 2 sentences');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 600));

    // Get the send button (it's a primary button)
    let sendBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => 
      b.className && b.className.includes('ds-button--primary') && !b.className.includes('ds-button--disabled')
    );
    
    if (!sendBtn) {
      sendBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => 
        b.className && b.className.includes('bd74640a') && !b.className.includes('ds-button--disabled')
      );
    }

    const beforeClickHtml = sendBtn ? sendBtn.outerHTML : 'no active send button found';

    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fallback
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    // Capture states every 150ms for 1.5 seconds
    const states = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 150));
      
      // Look for any button or div in the input bar
      const inputs = Array.from(document.querySelectorAll('textarea, div[role="button"], button')).map(el => ({
        tag: el.tagName,
        class: el.className,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        disabled: el.disabled || el.getAttribute('aria-disabled'),
        html: el.outerHTML.substring(0, 200)
      }));

      // Look for elements with class containing 'stop' or 'loading' or 'streaming'
      const streamingEls = Array.from(document.querySelectorAll('*')).filter(el => {
        const c = el.className;
        return c && typeof c === 'string' && (c.includes('stop') || c.includes('loading') || c.includes('streaming') || c.includes('progress'));
      }).map(el => ({
        tag: el.tagName,
        class: el.className,
        html: el.outerHTML.substring(0, 150)
      }));

      states.push({
        timeMs: (i + 1) * 150,
        inputs,
        streamingEls: streamingEls.slice(0, 10)
      });
    }

    return { beforeClickHtml, states };
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
