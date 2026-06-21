const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(function() {
  try {
    const textareas = Array.from(document.querySelectorAll('textarea, input')).map(t => ({
      tag: t.tagName,
      name: t.getAttribute('name'),
      type: t.getAttribute('type'),
      class: t.className,
      id: t.id
    }));

    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
      tag: b.tagName,
      name: b.getAttribute('name'),
      type: b.getAttribute('type'),
      value: b.getAttribute('value'),
      class: b.className,
      id: b.id,
      ariaLabel: b.getAttribute('aria-label')
    }));

    return { textareas, buttons };
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
