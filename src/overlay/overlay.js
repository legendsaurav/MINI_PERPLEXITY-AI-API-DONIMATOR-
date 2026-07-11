/* ═══════════════════════════════════════════════════════
   AI Copilot Overlay — Controller
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────
  const $welcomeState  = document.getElementById('welcome-state');
  const $loadingState  = document.getElementById('loading-state');
  const $responseState = document.getElementById('response-state');
  const $errorState    = document.getElementById('error-state');
  const $markdownBody  = document.getElementById('markdown-body');
  const $streamCursor  = document.getElementById('stream-cursor');
  const $errorMessage  = document.getElementById('error-message');
  const $statusBadge   = document.getElementById('status-badge');
  const $statusText    = $statusBadge.querySelector('.status-text');
  const $modeBadge     = document.getElementById('mode-badge');
  const $modeName      = document.getElementById('mode-name');
  const $switchBadge   = document.getElementById('switch-badge');
  const $switchText    = document.getElementById('switch-text') || ($switchBadge ? $switchBadge.querySelector('.status-text') : null);
  const $projectBadge  = document.getElementById('project-badge');
  const $projectName   = document.getElementById('project-name');
  const $closeBtn      = document.getElementById('close-btn');
  const $contentArea   = document.getElementById('content-area');
  const $borderGlow    = document.querySelector('.border-glow');
  const $footer        = document.getElementById('footer');
  const $cursorToggleBadge = document.getElementById('cursor-toggle-badge');
  const $cursorToggleText  = document.getElementById('cursor-toggle-text');
  const $voiceToggleBadge  = document.getElementById('voice-toggle-badge');
  const $voiceToggleText   = document.getElementById('voice-toggle-text');
  const $stopVoiceBadge    = document.getElementById('stop-voice-badge');

  // ── State ─────────────────────────────────────────────
  let isStreaming = false;
  let renderScheduled = false;
  let pendingText = '';
  let speechUtterance = null;
  let voices = [];
  let maleVoice = null;
  let femaleVoice = null;
  let selectedVoice = null;

  function cleanResponseText(text) {
    if (!text) return '';
    return text.replace(/\[POINT:[^\]]*\]/gi, '').replace(/\[P[^\]]*$/i, '').trim();
  }

  function speakText(text) {
    if (!window.speechSynthesis) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();

    // Clean text for speech (strip markdown & point tags)
    const rawClean = cleanResponseText(text);
    const cleanSpokenText = rawClean
      .replace(/[*#`_\-]/g, '')                 // remove markdown syntax
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // replace links with link text
      .trim();

    if (!cleanSpokenText) return;

    speechUtterance = new SpeechSynthesisUtterance(cleanSpokenText);
    
    // Apply selected voice
    if (selectedVoice) {
      speechUtterance.voice = selectedVoice;
    }
    
    // Apply pitch fallback/enhancement based on gender
    const currentGender = localStorage.getItem('selectedVoiceGender') || 'female';
    if (currentGender === 'male') {
      speechUtterance.pitch = 0.85; // Lower pitch for male voice
    } else {
      speechUtterance.pitch = 1.15; // Higher pitch for female voice
    }
    
    speechUtterance.rate = 1.0;

    api.notifyVoiceState('speaking');

    speechUtterance.onstart = () => {
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = '';
    };

    speechUtterance.onend = () => {
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = 'none';
      api.notifyVoiceState('idle');
      speechUtterance = null;
    };

    speechUtterance.onerror = (e) => {
      console.error('[SpeechSynthesis] Error:', e);
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = 'none';
      api.notifyVoiceState('idle');
      speechUtterance = null;
    };

    window.speechSynthesis.speak(speechUtterance);
  }

  // ── Configure marked.js ───────────────────────────────
  const renderer = new marked.Renderer();

  // Custom code block renderer — wraps in container with header + copy btn
  renderer.code = function (codeObj) {
    // marked v12+ passes an object { text, lang, escaped }
    const text = typeof codeObj === 'object' ? (codeObj.text || '') : codeObj;
    const lang = typeof codeObj === 'object' ? (codeObj.lang || '') : (arguments[1] || '');

    const langLabel = sanitize(lang || 'code');
    let highlighted;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
    } catch {
      highlighted = sanitize(text);
    }

    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${langLabel}</span>
        <button class="code-copy-btn" onclick="window.__copyCode(this)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy
        </button>
      </div>
      <pre><code class="hljs">${highlighted}</code></pre>
    </div>`;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true,
    pedantic: false,
    smartypants: false,
    highlight: null          // we handle it in renderer.code
  });

  // ── Helpers ───────────────────────────────────────────
  function sanitize(str) {
    const el = document.createElement('div');
    el.textContent = str;
    return el.innerHTML;
  }

  function showState(name) {
    [$welcomeState, $loadingState, $responseState, $errorState].forEach(el => {
      el.classList.add('hidden');
    });
    const target = {
      welcome:  $welcomeState,
      loading:  $loadingState,
      response: $responseState,
      error:    $errorState
    }[name];
    if (target) {
      target.classList.remove('hidden');
      // Re-trigger fade animation
      target.style.animation = 'none';
      target.offsetHeight;                   // force reflow
      target.style.animation = '';
    }
  }

  function setStatus(type, text) {
    $statusBadge.className = 'status-badge ' + type;
    $statusText.textContent = text;
  }

  function setBorderGlow(type) {
    $borderGlow.classList.remove('streaming', 'error');
    if (type) $borderGlow.classList.add(type);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      $contentArea.scrollTop = $contentArea.scrollHeight;
    });
  }

  // ── Render Markdown (throttled via rAF) ───────────────
  function scheduleRender(fullText) {
    pendingText = fullText;
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(doRender);
    }
  }

  function doRender() {
    renderScheduled = false;
    if (!pendingText && pendingText !== '') return;

    const cleaned = cleanResponseText(pendingText);
    try {
      $markdownBody.innerHTML = marked.parse(cleaned);
    } catch {
      $markdownBody.textContent = cleaned;
    }

    scrollToBottom();
  }

  // ── Copy code helper (global) ─────────────────────────
  window.__copyCode = function (btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper.querySelector('pre code');
    const text = codeEl.textContent;

    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Copied!`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy`;
      }, 2000);
    }).catch(() => {
      /* clipboard write failed silently */
    });
  };

  // ── Escape key (per-window, replaces removed global Escape) ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      // Cancel active request or end frozen context session
      if (window.copilotAPI && typeof window.copilotAPI.cancelRequest === 'function') {
        window.copilotAPI.cancelRequest();
      }
      // Hide overlay
      if (window.copilotAPI && typeof window.copilotAPI.toggleOverlay === 'function') {
        window.copilotAPI.toggleOverlay();
      }
    }
  });

  // ── Close button ──────────────────────────────────────
  $closeBtn.addEventListener('click', () => {
    if (window.copilotAPI && typeof window.copilotAPI.toggleOverlay === 'function') {
      window.copilotAPI.toggleOverlay();
    }
  });

  // ── Connect to copilotAPI ─────────────────────────────
  if (!window.copilotAPI) {
    console.warn('[Overlay] window.copilotAPI not found — running in standalone mode.');
    return;
  }

  const api = window.copilotAPI;

  // Stream Start
  api.onStreamStart(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isStreaming = true;
    pendingText = '';
    $markdownBody.innerHTML = '';
    showState('loading');
    setStatus('streaming', 'Thinking…');
    setBorderGlow('streaming');
    $streamCursor.classList.remove('visible');
    $footer.style.display = '';
  });

  // Stream Chunk
  api.onStreamChunk(({ data, fullText }) => {
    if (!isStreaming) {
      // If we somehow missed onStreamStart
      isStreaming = true;
      setBorderGlow('streaming');
      setStatus('streaming', 'Streaming…');
    }
    // Switch from loading shimmer to response on first chunk
    if ($loadingState && !$loadingState.classList.contains('hidden')) {
      showState('response');
      $streamCursor.classList.add('visible');
      setStatus('streaming', 'Streaming…');
    }

    scheduleRender(fullText);
  });

  // Stream End
  api.onStreamEnd(({ fullText }) => {
    isStreaming = false;
    $streamCursor.classList.remove('visible');
    showState('response');
    setStatus('idle', 'Ready');
    setBorderGlow('');

    const textToUse = fullText || pendingText;
    const cleaned = cleanResponseText(textToUse);

    // Final render to ensure completeness
    try {
      $markdownBody.innerHTML = marked.parse(cleaned);
    } catch {
      $markdownBody.textContent = cleaned;
    }

    scrollToBottom();

    // Parse point coordinates
    const pointMatch = textToUse.match(/\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]/i);
    if (pointMatch) {
      const xText = pointMatch[1];
      const yText = pointMatch[2];
      if (xText && yText) {
        const x = parseInt(xText, 10);
        const y = parseInt(yText, 10);
        const label = pointMatch[3] ? pointMatch[3].trim() : null;
        const screenNum = pointMatch[4] ? parseInt(pointMatch[4], 10) : null;
        
        const hideCursor = localStorage.getItem('hideClickyCursor') === 'true';
        if (!hideCursor) {
          console.log(`[Overlay] Triggering screen pointer at (${x}, ${y}) label: ${label} screen: ${screenNum}`);
          api.triggerPointer({ x, y, label, screenNum });
        } else {
          console.log(`[Overlay] Clicky cursor is set to hide. Skipping pointer trigger at (${x}, ${y})`);
        }
      }
    }

    // Speak finalized text
    speakText(cleaned);
  });

  // Stream Error
  api.onStreamError(({ error }) => {
    isStreaming = false;
    $streamCursor.classList.remove('visible');
    showState('error');
    $errorMessage.textContent = error || 'An unexpected error occurred.';
    setStatus('error', 'Error');
    setBorderGlow('error');
  });

  // Project Updated
  api.onProjectUpdated(({ project_name }) => {
    if (project_name) {
      $projectName.textContent = project_name;
      $projectBadge.style.display = '';
    } else {
      $projectBadge.style.display = 'none';
    }
  });

  // Provider Switched
  if (api.onProviderSwitched) {
    api.onProviderSwitched((provider) => {
      const $providerName = document.getElementById('provider-name');
      if ($providerName) {
        $providerName.textContent = provider;
      }
    });
  }

  // Mode Selected (chat vs guider) — show a small badge in the header
  if (api.onModeSelected) {
    api.onModeSelected((mode) => {
      if (!$modeBadge || !$modeName) return;
      const isGuide = mode === 'guide';
      $modeName.textContent = isGuide ? 'Guide' : 'Chat';
      if (isGuide) {
        $modeBadge.style.background = 'rgba(96, 165, 250, 0.16)';
        $modeBadge.style.color = '#93c5fd';
        $modeBadge.style.borderColor = 'rgba(96, 165, 250, 0.4)';
      } else {
        $modeBadge.style.background = 'rgba(34, 211, 238, 0.15)';
        $modeBadge.style.color = '#67e8f9';
        $modeBadge.style.borderColor = 'rgba(34, 211, 238, 0.35)';
      }
      $modeBadge.style.display = 'none';
    });
  }

  // Model Switch — small timer while context is handed to the new model
  let switchCountdown = null;
  function clearSwitchCountdown() {
    if (switchCountdown) { clearInterval(switchCountdown); switchCountdown = null; }
  }
  if (api.onModelSwitchStarted) {
    api.onModelSwitchStarted((data) => {
      if (!$switchBadge || !$switchText) return;
      const to = (data && data.to) || 'model';
      let remaining = Math.max(1, Math.round(((data && data.etaMs) || 6000) / 1000));
      $switchBadge.style.display = '';
      const tick = () => {
        $switchText.textContent = remaining > 0
          ? `Switching to ${to}… ${remaining}s`
          : `Handing over context to ${to}…`;
        remaining -= 1;
      };
      tick();
      clearSwitchCountdown();
      switchCountdown = setInterval(tick, 1000);
    });
  }
  if (api.onModelSwitchReady) {
    api.onModelSwitchReady((data) => {
      if (!$switchBadge || !$switchText) return;
      clearSwitchCountdown();
      const to = (data && data.to) || 'model';
      $switchText.textContent = `✓ ${to} ready`;
      setTimeout(() => { if ($switchBadge) $switchBadge.style.display = 'none'; }, 2200);
    });
  }

  // Voice State Changes
  api.onVoiceStateChanged((state) => {
    console.log(`[Overlay] Voice state changed to: ${state}`);
    if (state === 'listening') {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      isStreaming = false;
      pendingText = '';
      $markdownBody.innerHTML = '';
      showState('welcome');
      setStatus('listening', 'Listening…');
      setBorderGlow('streaming');
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = 'none';
    } else if (state === 'processing') {
      showState('loading');
      setStatus('processing-voice', 'Processing Voice…');
      setBorderGlow('streaming');
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = 'none';
    } else if (state === 'speaking') {
      setStatus('speaking', 'Speaking…');
      setBorderGlow('streaming');
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = '';
    } else if (state === 'idle') {
      if ($stopVoiceBadge) $stopVoiceBadge.style.display = 'none';
      if (!isStreaming) {
        setStatus('idle', 'Ready');
        setBorderGlow('');
      }
    }
  });

  // Fetch initial settings
  if (api.getSettings) {
    api.getSettings().then(settings => {
      if (settings && settings.provider) {
        const $providerName = document.getElementById('provider-name');
        if ($providerName) {
          $providerName.textContent = settings.provider;
        }
      }
    }).catch(err => console.error("Could not fetch settings", err));
  }
  // ── Agent Status Bar ─────────────────────────────────
  const $agentBar = document.getElementById('agent-bar');
  const $agentTaskName = document.getElementById('agent-task-name');
  const $agentStepText = document.getElementById('agent-step-text');
  const $agentStopBtn = document.getElementById('agent-stop-btn');

  if ($agentStopBtn) {
    $agentStopBtn.addEventListener('click', () => {
      if (api.stopAgent) {
        api.stopAgent();
      }
    });
  }

  // Agent Started
  if (api.onAgentStarted) {
    api.onAgentStarted(({ task }) => {
      console.log('[Overlay] Agent started:', task);
      if ($agentBar) $agentBar.classList.remove('hidden');
      if ($agentTaskName) $agentTaskName.textContent = task;
      if ($agentStepText) $agentStepText.textContent = 'Initializing…';
      setStatus('streaming', 'Agent Running');
      setBorderGlow('streaming');
    });
  }

  // Agent Progress
  if (api.onAgentProgress) {
    api.onAgentProgress((progress) => {
      console.log('[Overlay] Agent progress:', progress.type);
      if (progress.type === 'agent_iteration') {
        if ($agentStepText) $agentStepText.textContent = `Step ${progress.iteration}/${progress.max_iterations}`;
      } else if (progress.type === 'agent_step') {
        if ($agentStepText) {
          const stepText = progress.step || '';
          $agentStepText.textContent = stepText.length > 50 ? stepText.substring(0, 47) + '…' : stepText;
        }
      } else if (progress.type === 'agent_action') {
        const actionText = `${progress.action}: ${progress.target}`;
        if ($agentStepText) $agentStepText.textContent = actionText.length > 50 ? actionText.substring(0, 47) + '…' : actionText;
      } else if (progress.type === 'agent_error') {
        if ($agentStepText) $agentStepText.textContent = '⚠ ' + (progress.error || 'Error');
      } else if (progress.type === 'agent_retry') {
        if ($agentStepText) $agentStepText.textContent = `Retrying (${progress.attempt}/${progress.max_retries})…`;
      }
    });
  }

  // Agent Finished
  if (api.onAgentFinished) {
    api.onAgentFinished((data) => {
      console.log('[Overlay] Agent finished:', data.type);
      if ($agentBar) $agentBar.classList.add('hidden');
      
      if (data.type === 'agent_complete') {
        setStatus('idle', 'Task Complete ✓');
        setBorderGlow('');
        setTimeout(() => setStatus('idle', 'Ready'), 5000);
      } else if (data.type === 'agent_stopped') {
        setStatus('idle', 'Agent Stopped');
        setBorderGlow('');
        setTimeout(() => setStatus('idle', 'Ready'), 3000);
      } else {
        setStatus('idle', 'Ready');
        setBorderGlow('');
      }
    });
  }

  // ── Voice / Cursor UI Logic & Clicks ────────────────────────
  function updateVoiceUI() {
    const currentGender = localStorage.getItem('selectedVoiceGender') || 'female';
    if ($voiceToggleText) {
      $voiceToggleText.textContent = `Voice: ${currentGender.charAt(0).toUpperCase() + currentGender.slice(1)}`;
    }
  }

  function loadVoices() {
    if (!window.speechSynthesis) return;
    voices = window.speechSynthesis.getVoices();
    
    // Look for a female voice
    const femaleKeywords = ['zira', 'helen', 'hazel', 'susan', 'female', 'natural', 'aria', 'samantha', 'victoria', 'female', 'haruka', 'nanami'];
    // Look for a male voice
    const maleKeywords = ['david', 'george', 'male', 'ravi', 'mark', 'male', 'keita', 'ichiro'];

    femaleVoice = null;
    maleVoice = null;

    for (const v of voices) {
      const nameLower = v.name.toLowerCase();
      if (!femaleVoice && femaleKeywords.some(kw => nameLower.includes(kw))) {
        femaleVoice = v;
      }
      if (!maleVoice && maleKeywords.some(kw => nameLower.includes(kw))) {
        maleVoice = v;
      }
    }

    // Fallback 1: English voices
    if (!femaleVoice || !maleVoice) {
      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      for (const v of enVoices) {
        const nameLower = v.name.toLowerCase();
        if (!femaleVoice && (nameLower.includes('zira') || nameLower.includes('hazel') || nameLower.includes('siri') || nameLower.includes('google') || nameLower.includes('female'))) {
          femaleVoice = v;
        }
        if (!maleVoice && (nameLower.includes('david') || nameLower.includes('mark') || nameLower.includes('google') || nameLower.includes('male'))) {
          maleVoice = v;
        }
      }
    }

    // Fallback 2: Any voices
    if (!femaleVoice && voices.length > 0) {
      femaleVoice = voices[0];
    }
    if (!maleVoice && voices.length > 0) {
      maleVoice = voices[Math.min(1, voices.length - 1)];
    }

    const currentGender = localStorage.getItem('selectedVoiceGender') || 'female';
    selectedVoice = (currentGender === 'male') ? maleVoice : femaleVoice;
    updateVoiceUI();
  }

  if (window.speechSynthesis) {
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    loadVoices();
  }

  if ($voiceToggleBadge) {
    $voiceToggleBadge.addEventListener('click', () => {
      const currentGender = localStorage.getItem('selectedVoiceGender') || 'female';
      const newGender = (currentGender === 'female') ? 'male' : 'female';
      localStorage.setItem('selectedVoiceGender', newGender);
      selectedVoice = (newGender === 'male') ? maleVoice : femaleVoice;
      updateVoiceUI();
      
      // If currently speaking, restart speaking with the new voice
      if (speechUtterance && window.speechSynthesis.speaking) {
        const currentText = speechUtterance.text;
        window.speechSynthesis.cancel();
        speakText(currentText);
      }
    });
  }

  if ($stopVoiceBadge) {
    $stopVoiceBadge.addEventListener('click', () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      $stopVoiceBadge.style.display = 'none';
      api.notifyVoiceState('idle');
      speechUtterance = null;
    });
  }

  function updateCursorUI() {
    const hideCursor = localStorage.getItem('hideClickyCursor') === 'true';
    if ($cursorToggleText) {
      $cursorToggleText.textContent = hideCursor ? 'Guider: Off' : 'Guider: On';
    }
    if ($cursorToggleBadge) {
      if (hideCursor) {
        $cursorToggleBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        $cursorToggleBadge.style.color = '#ef4444';
        $cursorToggleBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      } else {
        $cursorToggleBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        $cursorToggleBadge.style.color = '#10b981';
        $cursorToggleBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
    }
    if (api.toggleCursor) {
      api.toggleCursor(hideCursor);
    }
  }

  if ($cursorToggleBadge) {
    $cursorToggleBadge.addEventListener('click', () => {
      const hideCursor = localStorage.getItem('hideClickyCursor') === 'true';
      const newHide = !hideCursor;
      localStorage.setItem('hideClickyCursor', newHide ? 'true' : 'false');
      updateCursorUI();
    });
  }

  updateCursorUI();

})();
