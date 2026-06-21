const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  try {
    const target = document.querySelector('textarea[name="q"]') || document.querySelector('input[name="q"]');
    if (!target) return { error: 'No google search box found' };

    target.focus();
    target.value = '';
    document.execCommand('insertText', false, 'what is gravity');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 600));

    // Submit by form requestSubmit or clicking the search button
    const form = target.closest('form');
    if (form) {
      form.submit();
    } else {
      const btn = document.querySelector('input[name="btnK"]');
      if (btn) btn.click();
    }

    // Wait 3 seconds for search results to load
    await new Promise(r => setTimeout(r, 3000));

    // Analyze results DOM
    const currentUrl = window.location.href;
    const bodyText = document.body ? document.body.innerText.substring(0, 1000) : '';

    // Find search result selectors (div[data-ved], .g, #search, etc.)
    const searchResults = Array.from(document.querySelectorAll('.g, div[data-ved], #search')).slice(0, 10).map(el => ({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      text: el.innerText ? el.innerText.substring(0, 100) : ''
    }));

    // Find elements containing search answer summaries (e.g. AI Overview or featured snippets)
    // Google AI overview is usually in a div with some specific class, or featured snippet is in div.kp-blk, div.g
    const featuredSnippet = Array.from(document.querySelectorAll('.kp-blk, .LGO13b, .x27ce')).map(el => ({
      class: el.className,
      text: el.innerText ? el.innerText.substring(0, 200) : ''
    }));

    return { currentUrl, bodyTextSummary: bodyText, searchResults, featuredSnippet };
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
