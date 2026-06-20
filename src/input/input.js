// ───────────────────────────────────────────────
//  Copilot Input Bar — Controller
// ───────────────────────────────────────────────

(function () {
  'use strict';

  const wrapper    = document.getElementById('inputWrapper');
  const input      = document.getElementById('inputField');
  const badge      = document.getElementById('screenshotBadge');
  const enterHint  = document.getElementById('enterHint');

  let hasScreenshot = false;

  // ── Focus / blur styling ──

  input.addEventListener('focus', () => {
    wrapper.classList.add('focused');
  });

  input.addEventListener('blur', () => {
    wrapper.classList.remove('focused');
  });

  // ── Input state tracking (show enter hint when text exists) ──

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    wrapper.classList.toggle('has-text', hasText);
    enterHint.classList.toggle('visible', hasText);
  });

  // ── Keyboard shortcuts ──

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      // Dismiss animation then submit
      wrapper.classList.add('dismissing');
      setTimeout(() => {
        if (window.copilotAPI && typeof window.copilotAPI.submitQuestion === 'function') {
          window.copilotAPI.submitQuestion(text);
        }
      }, 140);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      wrapper.classList.add('dismissing');
      setTimeout(() => {
        if (window.copilotAPI && typeof window.copilotAPI.cancelRequest === 'function') {
          window.copilotAPI.cancelRequest();
        }
      }, 140);
      return;
    }
  });

  // ── Show input handler (called from main process via preload) ──

  function handleShow(data) {
    const prefill = (data && data.prefill) || '';
    hasScreenshot = !!(data && data.hasScreenshot);

    // Reset state
    wrapper.classList.remove('dismissing', 'has-text');
    enterHint.classList.remove('visible');

    // Re-trigger appear animation
    wrapper.style.animation = 'none';
    wrapper.offsetHeight; // force reflow
    wrapper.style.animation = '';

    // Screenshot badge
    if (hasScreenshot) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // Set input value
    input.value = prefill;

    // Update enter hint if prefill has text
    if (prefill.trim().length > 0) {
      wrapper.classList.add('has-text');
      enterHint.classList.add('visible');
    }

    // Focus and select all (slight delay for window to be ready)
    requestAnimationFrame(() => {
      input.focus();
      if (prefill) {
        input.select();
      }
    });
  }

  // ── Register with copilotAPI ──

  if (window.copilotAPI && typeof window.copilotAPI.onShowInput === 'function') {
    window.copilotAPI.onShowInput(handleShow);
  }

  // ── Auto-focus on load as fallback ──

  window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => input.focus());
  });

  // Also focus when window gains focus (in case of re-show without event)
  window.addEventListener('focus', () => {
    requestAnimationFrame(() => input.focus());
  });
})();
