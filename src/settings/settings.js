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

// Listen for provider changes
providerRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    // Save settings via IPC
    window.copilotAPI.saveSettings({ provider: radio.value });
    updateAuthStatus();
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
  if (settings && settings.provider) {
    const radio = document.querySelector(`input[value="${settings.provider}"]`);
    if (radio) radio.checked = true;
  }
  updateAuthStatus();
}

init();
