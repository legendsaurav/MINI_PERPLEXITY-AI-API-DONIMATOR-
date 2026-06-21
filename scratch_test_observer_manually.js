const http = require('http');
const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';

const jsCode = `(async function() {
  try {
    const logs = [];
    
    // Set up a custom manual observer
    if (window.__manualObserver) {
      window.__manualObserver.disconnect();
    }
    
    let sawStop = false;
    let sawSendDisabled = false;
    
    window.__manualObserver = new MutationObserver((mutations) => {
      const isStopButtonVisible = !!document.querySelector('.ds-loading');
      
      const sendBtn = document.querySelector('div[role="button"].ds-button--primary, button.send-btn');
      const isSendButtonEnabled = sendBtn && 
                                  !sendBtn.disabled && 
                                  sendBtn.getAttribute('aria-disabled') !== 'true' &&
                                  !sendBtn.className.includes('ds-button--disabled'); // Fix checking class name too!
      
      if (isStopButtonVisible) {
        sawStop = true;
      }
      if (!isSendButtonEnabled) {
        sawSendDisabled = true;
      }
      
      logs.push({
        time: Date.now(),
        mutations: mutations.length,
        isStopButtonVisible,
        isSendButtonEnabled,
        sendBtnClass: sendBtn ? sendBtn.className : 'null',
        responseAreaCount: document.querySelectorAll('.ds-markdown.ds-assistant-message-main-content').length
      });
    });
    
    window.__manualObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    // Trigger submit
    const target = document.querySelector('textarea');
    if (!target) return { error: 'No textarea found' };
    
    target.focus();
    target.select();
    document.execCommand('insertText', false, 'Explain the solar system in 5 words');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    
    const btn = document.querySelector('div[role="button"].ds-button--primary');
    if (btn) btn.click();
    
    // Wait 3 seconds to let streaming happen and capture logs
    await new Promise(r => setTimeout(r, 3000));
    
    window.__manualObserver.disconnect();
    
    return { sawStop, sawSendDisabled, logs };
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
