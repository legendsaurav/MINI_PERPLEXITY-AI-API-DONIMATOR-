'use strict';

const { TOTAL_CHAR_CAP } = require('./file-attachment');

/**
 * Prompt Composer
 * ---------------------------------------------------------------------------
 * Builds the FINAL prompt string injected into the provider, given the routed
 * mode (guide vs chat), the raw user question, the captured context, and any
 * attached files.
 *
 *   compose({ mode, rawQuestion, contextObject, files, image }) -> string
 *
 * - GUIDE mode prepends instructions that make the AI analyze the screenshot
 *   and emit a [POINT:x,y:label] marker (the overlay parses this and the
 *   pointer window draws an arrow at that on-screen location).
 * - CHAT mode prepends instructions for a concise, helpful text answer with no
 *   coordinate tags.
 * Both preambles explicitly tell the model the prompt may be vague/misspelled
 * and to infer the user's true intent — this is what makes "bad" prompts work.
 */

function guidePreamble(width, height) {
  const dims = (width && height) ? `${width}×${height} pixels` : 'the size shown';
  return [
    'You are a screen-guidance assistant. The user wants to be SHOWN where something is on their screen.',
    `A screenshot of their current screen is attached. It is ${dims}, with the origin (0,0) at the TOP-LEFT corner; x increases to the right, y increases downward.`,
    'Identify the single UI element the user is asking about. Then reply in this exact shape:',
    '  1. One short, friendly sentence telling them what/where it is.',
    '  2. On its own final line, output EXACTLY one marker:',
    '     [POINT:x,y:label]',
    '     where x and y are INTEGER pixel coordinates of the CENTER of that element within the screenshot, and label is a 1–3 word name (e.g. "Save button").',
    'If the element is not visible on the current screen, output [POINT:none] and briefly say where to find it instead.',
    "The user's request may be vague, misspelled, or low quality — infer their true intent. Do not output any other bracketed tags or coordinates.",
  ].join('\n');
}

const CHAT_PREAMBLE = [
  'You are a concise, helpful desktop assistant. Answer the user\'s request directly and clearly using Markdown.',
  "The user's request may be vague, misspelled, or low quality — infer their most likely intent and answer that. If truly ambiguous, give the best general answer and note any assumption in one short line.",
  'Do NOT output any [POINT:...] tags or screen coordinates.',
].join('\n');

function fileBlock(file) {
  const header = `--- File: ${file.name} [${file.kind}${file.truncated ? ', truncated' : ''}] ---`;
  if (file.kind === 'image') {
    return `${header}\n(Image attached — see the attached picture.)`;
  }
  if (file.inlineText && file.inlineText.trim()) {
    return `${header}\n\`\`\`\n${file.inlineText}\n\`\`\``;
  }
  return `${header}\n${file.note || '(no extractable text)'}`;
}

function compose({ mode, rawQuestion, contextObject = {}, files = [], image = null }) {
  const parts = [];

  // 1. Mode-specific system preamble.
  if (mode === 'guide') {
    parts.push(guidePreamble(image && image.width, image && image.height));
  } else {
    parts.push(CHAT_PREAMBLE);
  }

  // 2. Light system context (only when meaningfully known).
  const sysLines = [];
  if (contextObject.application && contextObject.application !== 'Unknown') {
    sysLines.push(`- Active Application: ${contextObject.application}`);
  }
  if (contextObject.window_title && contextObject.window_title !== 'Unknown') {
    sysLines.push(`- Window Title: ${contextObject.window_title}`);
  }
  if (contextObject.project && contextObject.project !== 'Default') {
    sysLines.push(`- Project: ${contextObject.project}`);
  }
  if (sysLines.length) {
    parts.push(`[System Context]\n${sysLines.join('\n')}`);
  }

  // 3. Selected text, if any.
  if (contextObject.selected_text && String(contextObject.selected_text).trim()) {
    parts.push(`[Selected Text]\n${contextObject.selected_text}`);
  }

  // 4. Attached files (respecting the overall character budget).
  if (Array.isArray(files) && files.length) {
    const blocks = [];
    let used = 0;
    let dropped = 0;
    for (const f of files) {
      const block = fileBlock(f);
      if (used + block.length > TOTAL_CHAR_CAP) { dropped++; continue; }
      blocks.push(block);
      used += block.length;
    }
    if (dropped > 0) {
      blocks.push(`(+${dropped} more attached file(s) omitted to stay within the size limit.)`);
    }
    if (blocks.length) {
      parts.push(`[Attached Files]\n${blocks.join('\n\n')}`);
    }
  }

  // 5. The actual user request (raw — the preamble already tells the AI to
  //    interpret it generously).
  parts.push(`[User Request]\n${rawQuestion}`);

  return parts.join('\n\n').trim();
}

module.exports = { compose, guidePreamble, CHAT_PREAMBLE };
