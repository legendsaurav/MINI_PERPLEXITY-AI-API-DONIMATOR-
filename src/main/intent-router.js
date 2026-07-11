'use strict';

/**
 * Intent Router
 * ---------------------------------------------------------------------------
 * Decides, for ANY user prompt (even vague, short, or misspelled), whether the
 * request should be answered as a normal CHAT (text answer in the overlay) or
 * handled by the GUIDER model (point at an on-screen UI element via
 * [POINT:x,y:label]).
 *
 * Pure heuristic — no network call — so routing is instant. Robust to typos via
 * a tiny inline edit-distance check against the keyword tables below.
 *
 *   classifyIntent(question, { hasScreenshot, hasAttachedImage })
 *     -> { mode: 'guide' | 'chat', confidence: 0..1, guideScore, chatScore }
 *
 * Weight tables are exported so they can be tuned without touching the logic.
 */

// Verbs / words that imply the user wants to be SHOWN where something is.
const GUIDE_WEIGHTS = {
  where: 3, locate: 3, highlight: 3, pinpoint: 3, point: 2,
  show: 2, find: 2, navigate: 2, guide: 2,
  click: 2, tap: 2, press: 2, select: 1, choose: 1,
  open: 1, enable: 1, disable: 1, toggle: 1, switch: 1, reach: 1,
};

// UI nouns — their presence strongly suggests on-screen guidance.
const GUIDE_UI_NOUNS = {
  button: 2, icon: 2, menu: 2, tab: 2, field: 2, setting: 2, settings: 2,
  option: 1, checkbox: 2, dropdown: 2, toolbar: 2, sidebar: 2, slider: 2,
  panel: 1, dialog: 1, link: 1, tab_: 1, gear: 2, hamburger: 2, avatar: 1,
};

// Words that imply the user wants an explanation / generation (normal chat).
const CHAT_WEIGHTS = {
  explain: 3, write: 3, summarize: 3, summary: 2, define: 3, definition: 2,
  translate: 3, meaning: 2, why: 2, difference: 2, compare: 2, calculate: 2,
  debug: 2, refactor: 2, review: 2, describe: 1, generate: 2, convert: 1,
  rewrite: 2, fix: 1, code: 1, list: 1, give: 1, tell: 1,
};

// Multi-word phrases (matched against the normalized string) with a big push.
const GUIDE_PHRASES = [
  /\bshow me (where|the|how)\b/, /\bwhere (is|are|can i|do i|to)\b/,
  /\bhow (do|can) i (find|get to|open|click|reach|navigate|enable|access)\b/,
  /\bwhich (button|icon|menu|tab|option|one)\b/, /\btake me to\b/,
  /\bpoint (me )?(to|at)\b/, /\bguide me\b/, /\bhelp me find\b/,
];
const CHAT_PHRASES = [
  /\bwhat (is|are|does|do|was)\b/, /\bhow (do|does) .* work\b/,
  /\bcan you (explain|write|summarize|tell|help me understand)\b/,
  /\btell me about\b/, /\bgive me (an?|the) (example|summary|overview)\b/,
];

/** Returns true if edit distance between a and b is <= 1 (typo tolerance). */
function within1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Both length >=4 to avoid over-matching short tokens.
  if (la < 4 || lb < 4) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }          // substitution
    else if (la > lb) { i++; }            // deletion from a
    else { j++; }                         // insertion into a
  }
  return true;
}

/** Best (exact or typo-near) weight for a token against a weight table. */
function lookup(token, table) {
  if (Object.prototype.hasOwnProperty.call(table, token)) return table[token];
  for (const key in table) {
    if (within1(token, key)) return table[key] * 0.8; // slight discount for fuzzy
  }
  return 0;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function classifyIntent(question, opts = {}) {
  const { hasScreenshot = false, hasAttachedImage = false } = opts;
  const norm = normalize(question);
  const tokens = norm.replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);

  let guideScore = 0;
  let chatScore = 0;

  for (const tok of tokens) {
    guideScore += lookup(tok, GUIDE_WEIGHTS);
    guideScore += lookup(tok, GUIDE_UI_NOUNS);
    chatScore += lookup(tok, CHAT_WEIGHTS);
  }

  for (const re of GUIDE_PHRASES) if (re.test(norm)) guideScore += 4;
  for (const re of CHAT_PHRASES) if (re.test(norm)) chatScore += 4;

  // A screenshot in hand makes guidance much more likely; an attached image
  // (file) is usually something the user wants described → leans chat.
  if (hasScreenshot) guideScore += 2;
  if (hasAttachedImage) chatScore += 2;

  let mode;
  if (guideScore === chatScore) {
    mode = hasScreenshot ? 'guide' : 'chat'; // tie-break
  } else {
    mode = guideScore > chatScore ? 'guide' : 'chat';
  }

  const total = guideScore + chatScore;
  const confidence = total === 0 ? 0 : Math.min(1, Math.abs(guideScore - chatScore) / (total + 1));

  return { mode, confidence, guideScore, chatScore };
}

module.exports = { classifyIntent, GUIDE_WEIGHTS, GUIDE_UI_NOUNS, CHAT_WEIGHTS };
