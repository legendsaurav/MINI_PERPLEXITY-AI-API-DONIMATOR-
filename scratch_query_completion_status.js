const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(function() {
  return {
    sawStopButton: window.__sawStopButton,
    sawSendButtonDisabled: window.__sawSendButtonDisabled,
    hasLoadingSpinner: !!document.querySelector('.ds-loading'),
    stabilityTimerExists: !!window.__copilotStabilityTimer,
    observerExists: !!window.__copilotObserver,
    lastResponseText: (() => {
      const el = document.querySelector('.ds-markdown.ds-assistant-message-main-content');
      return el ? el.innerText : 'null';
    })()
  };
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
