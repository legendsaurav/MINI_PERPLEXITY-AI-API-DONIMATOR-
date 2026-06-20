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
  const $projectBadge  = document.getElementById('project-badge');
  const $projectName   = document.getElementById('project-name');
  const $closeBtn      = document.getElementById('close-btn');
  const $contentArea   = document.getElementById('content-area');
  const $borderGlow    = document.querySelector('.border-glow');
  const $footer        = document.getElementById('footer');

  // ── State ─────────────────────────────────────────────
  let isStreaming = false;
  let renderScheduled = false;
  let pendingText = '';

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

    try {
      $markdownBody.innerHTML = marked.parse(pendingText);
    } catch {
      $markdownBody.textContent = pendingText;
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

    // Final render to ensure completeness
    try {
      $markdownBody.innerHTML = marked.parse(fullText || pendingText);
    } catch {
      $markdownBody.textContent = fullText || pendingText;
    }

    scrollToBottom();
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

})();
