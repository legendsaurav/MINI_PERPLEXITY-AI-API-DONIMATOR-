const providerRadios = document.querySelectorAll('input[name="provider"]');
const loginBtn = document.getElementById('login-btn');
const authStatus = document.getElementById('auth-status');

// Helper to get selected provider
function getSelectedProvider() {
  const selected = document.querySelector('input[name="provider"]:checked');
  return selected ? selected.value : 'chatgpt';
}

// Update UI based on auth status
async function updateAuthStatus() {
  const provider = getSelectedProvider();
  authStatus.textContent = 'Checking...';
  authStatus.className = 'auth-status';
  
  // Ask main process for status
  const isAuth = await window.copilotAPI.getAuthStatus(provider);
  
  if (isAuth) {
    authStatus.textContent = 'Status: Logged In';
    authStatus.classList.add('authenticated');
    loginBtn.textContent = 'Manage Session';
  } else {
    authStatus.textContent = 'Status: Not Logged In';
    authStatus.classList.add('unauthenticated');
    loginBtn.textContent = 'Log In';
  }
}

const delayInputs = document.querySelectorAll('.delay-input');
const saveStatus = document.getElementById('save-status');
let saveTimeout = null;

function showSavedIndicator() {
  if (saveStatus) {
    saveStatus.textContent = 'Settings Saved';
    saveStatus.classList.add('show');
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveStatus.classList.remove('show');
    }, 2000);
  }
}

function saveAllSettings() {
  const provider = getSelectedProvider();
  const screenshotDelays = {};
  delayInputs.forEach(input => {
    const p = input.getAttribute('data-provider');
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
      screenshotDelays[p] = val;
    }
  });
  window.copilotAPI.saveSettings({ provider, screenshotDelays });
  showSavedIndicator();
}

// Listen for provider changes
providerRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    saveAllSettings();
    updateAuthStatus();
  });
});

// Listen for delay input changes
delayInputs.forEach(input => {
  input.addEventListener('change', () => {
    saveAllSettings();
  });
  input.addEventListener('input', () => {
    const prevTimeout = input.getAttribute('data-timeout-id');
    if (prevTimeout) clearTimeout(parseInt(prevTimeout, 10));
    const t = setTimeout(() => {
      saveAllSettings();
    }, 500);
    input.setAttribute('data-timeout-id', t.toString());
  });
});

// Login button click
loginBtn.addEventListener('click', () => {
  const provider = getSelectedProvider();
  // Tells main process to show the hidden browser window for manual login
  window.copilotAPI.loginProvider(provider);
});

// Initialize
async function init() {
  const settings = await window.copilotAPI.getSettings();
  if (settings) {
    if (settings.provider) {
      const radio = document.querySelector(`input[value="${settings.provider}"]`);
      if (radio) radio.checked = true;
    }
    if (settings.screenshotDelays) {
      delayInputs.forEach(input => {
        const provider = input.getAttribute('data-provider');
        if (settings.screenshotDelays[provider] !== undefined) {
          input.value = settings.screenshotDelays[provider];
        }
      });
    }
  }
  updateAuthStatus();
  await loadKeysList();
}

// Stored keys loader
async function loadKeysList() {
  const tableBody = document.getElementById('keys-table-body');
  if (!tableBody) return;

  try {
    const keys = await window.copilotAPI.getApiKeys();
    if (!keys || keys.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="table-empty">No keys generated yet.</td></tr>`;
      return;
    }

    tableBody.innerHTML = keys.map(key => {
      const date = new Date(key.createdAt).toLocaleString();
      const modelsList = key.models.join(', ');
      return `
        <tr>
          <td>${escapeHtml(key.username)}</td>
          <td><code>${escapeHtml(key.maskedKey)}</code></td>
          <td>${escapeHtml(modelsList)}</td>
          <td><code>${escapeHtml(key.conversationID)}</code></td>
          <td><span class="status-badge ${key.status === 'active' ? 'active' : 'inactive'}">${key.status}</span></td>
          <td>${date}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load keys:', err);
    tableBody.innerHTML = `<tr><td colspan="6" class="table-empty error">Failed to load keys: ${err.message}</td></tr>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Generate API Key Bindings
const generateBtn = document.getElementById('apikey-generate-btn');
const genUsernameInput = document.getElementById('apikey-username');
const genPasswordInput = document.getElementById('apikey-password');
const genConvIDInput = document.getElementById('apikey-convid');
const generateMsg = document.getElementById('generate-msg');

if (generateBtn) {
  generateBtn.addEventListener('click', async () => {
    const username = genUsernameInput.value.trim();
    const password = genPasswordInput.value.trim();
    const conversationID = genConvIDInput.value.trim();

    if (!username || !password) {
      showStatus(generateMsg, 'Username and password are required', 'error');
      return;
    }

    const availableModels = [];
    document.querySelectorAll('.model-checkbox:checked').forEach(cb => {
      availableModels.push(cb.value);
    });

    generateBtn.disabled = true;
    showStatus(generateMsg, 'Generating key...', '');

    try {
      await window.copilotAPI.generateApiKey({
        username,
        password,
        availableModels,
        conversationID
      });
      showStatus(generateMsg, 'API Key generated successfully! Verify below to reveal it.', 'success');
      genUsernameInput.value = '';
      genPasswordInput.value = '';
      genConvIDInput.value = '';
      await loadKeysList();
    } catch (err) {
      showStatus(generateMsg, `Error: ${err.message}`, 'error');
    } finally {
      generateBtn.disabled = false;
    }
  });
}

// Reveal API Key Bindings
const revealBtn = document.getElementById('apikey-reveal-btn');
const revUsernameInput = document.getElementById('apikey-reveal-username');
const revPasswordInput = document.getElementById('apikey-reveal-password');
const revealMsg = document.getElementById('reveal-msg');
const revealedContainer = document.getElementById('revealed-key-container');
const revealedInput = document.getElementById('revealed-key-input');
const copyBtn = document.getElementById('apikey-copy-btn');

if (revealBtn) {
  revealBtn.addEventListener('click', async () => {
    const username = revUsernameInput.value.trim();
    const password = revPasswordInput.value.trim();

    if (!username || !password) {
      showStatus(revealMsg, 'Username and password are required', 'error');
      return;
    }

    revealBtn.disabled = true;
    showStatus(revealMsg, 'Authenticating...', '');
    revealedContainer.style.display = 'none';

    try {
      const res = await window.copilotAPI.revealApiKey({ username, password });
      showStatus(revealMsg, 'Authenticated successfully!', 'success');
      revealedInput.value = res.apiKey;
      revealedContainer.style.display = 'block';
      revPasswordInput.value = '';
    } catch (err) {
      showStatus(revealMsg, `Error: ${err.message}`, 'error');
    } finally {
      revealBtn.disabled = false;
    }
  });
}

if (copyBtn && revealedInput) {
  copyBtn.addEventListener('click', () => {
    revealedInput.select();
    navigator.clipboard.writeText(revealedInput.value);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  });
}

function showStatus(element, text, className) {
  if (!element) return;
  element.textContent = text;
  element.className = 'form-status ' + className;
}

init();
