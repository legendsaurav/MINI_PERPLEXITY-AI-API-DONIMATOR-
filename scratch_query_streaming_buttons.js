const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(function() {
  try {
    const buttons = Array.from(document.querySelectorAll('div[role="button"], button')).map(b => ({
      tag: b.tagName,
      class: b.className,
      text: b.innerText ? b.innerText.substring(0, 30) : '',
      ariaLabel: b.getAttribute('aria-label'),
      html: b.outerHTML.substring(0, 300)
    }));
    
    // Check if there are any svgs inside these buttons or stop icons
    const svgs = Array.from(document.querySelectorAll('svg')).map(s => ({
      class: s.className,
      html: s.outerHTML.substring(0, 300)
    }));

    return { buttons: buttons.slice(0, 15), svgs: svgs.slice(0, 15) };
  } catch (err) {
    return { error: err.message };
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
