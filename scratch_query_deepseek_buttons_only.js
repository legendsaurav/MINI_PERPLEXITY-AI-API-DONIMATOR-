const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  try {
    const target = document.querySelector('textarea');
    if (!target) return { error: 'No textarea found' };

    // Get button before submit
    const btnBefore = document.querySelector('div[role="button"].ds-button--circle');
    const classBefore = btnBefore ? btnBefore.className : 'none';
    const htmlBefore = btnBefore ? btnBefore.outerHTML : 'none';

    target.focus();
    target.select();
    document.execCommand('insertText', false, 'Explain standard deviation in 1 short sentence');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));

    const btnReady = document.querySelector('div[role="button"].ds-button--circle');
    if (btnReady) btnReady.click();

    // Wait 500ms for streaming to start
    await new Promise(r => setTimeout(r, 600));

    const btnStreaming = document.querySelector('div[role="button"].ds-button--circle') || document.querySelector('div[role="button"].ds-button--primary');
    const classStreaming = btnStreaming ? btnStreaming.className : 'none';
    const htmlStreaming = btnStreaming ? btnStreaming.outerHTML : 'none';

    return { classBefore, htmlBefore, classStreaming, htmlStreaming };
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
