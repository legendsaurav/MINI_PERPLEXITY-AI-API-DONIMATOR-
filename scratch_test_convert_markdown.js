const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(function() {
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

  try {
    const el = document.querySelector('.ds-markdown.ds-assistant-message-main-content');
    if (!el) return { error: 'Element not found' };
    const md = convertToMarkdown(el);
    return { ok: true, md };
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
