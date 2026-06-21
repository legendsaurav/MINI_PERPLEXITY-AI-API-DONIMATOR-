const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  const target = document.querySelector('.chat-input-editor') || document.querySelector('div[contenteditable="true"]');
  if (!target) return { error: 'No input target found' };
  
  target.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('insertText', false, 'hello how are things going');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  
  await new Promise(r => setTimeout(r, 1000));
  
  const matches = [];
  // Find all elements that might be the send button
  document.querySelectorAll('[class*="send"], [class*="submit"], button, svg').forEach(el => {
    // Traverse up to find parent classes
    let parentClasses = [];
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++) {
      if (p.className) parentClasses.push(p.className);
      p = p.parentElement;
    }
    matches.push({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      parentClasses,
      outerHTML: el.outerHTML.substring(0, 150)
    });
  });
  
  // Also look for elements near the bottom right of the input
  const allDivs = Array.from(document.querySelectorAll('div, button'));
  const sendDivs = allDivs.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (el.className && typeof el.className === 'string' && el.className.includes('send'));
  }).map(el => ({ tag: el.tagName, class: el.className, outerHTML: el.outerHTML.substring(0, 150) }));
  
  // Get outerHTML of the parent of the input editor to see the full structure
  const parentOfInput = target.parentElement ? target.parentElement.outerHTML.substring(0, 3000) : 'not found';
  
  // Clear the input so we don't pollute
  target.innerHTML = '';
  target.dispatchEvent(new Event('input', { bubbles: true }));
  
  return { matches, sendDivs, parentOfInput };
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
