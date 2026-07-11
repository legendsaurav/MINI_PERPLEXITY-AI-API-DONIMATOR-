'use strict';

/**
 * Conversation Memory
 * ---------------------------------------------------------------------------
 * Keeps an app-side transcript of the current chat ({role, content} turns) plus
 * the most recent screenshot, so that when the user switches AI providers the
 * whole context can be handed to the new model. Provider conversations
 * otherwise live only as per-provider browser URLs, invisible across models.
 *
 *   addUserTurn(text) / addAssistantTurn(text)
 *   setScreenshot(dataURL, meta)
 *   hasContext() -> bool
 *   buildHandoffSeed() -> string   (prompt seeding the new model)
 *   getLastScreenshot() -> { dataURL, meta } | null
 *   clear()
 */

const MAX_TURNS = 12;            // keep the most recent N turns
const MAX_TURN_CHARS = 4000;     // cap a single turn
const MAX_SEED_CHARS = 12000;    // overall transcript budget in the seed

class ConversationMemory {
  constructor() {
    this.turns = [];               // [{ role: 'user'|'assistant', content }]
    this.lastScreenshot = null;    // { dataURL, meta }
  }

  _push(role, content) {
    const text = String(content || '').trim();
    if (!text) return;
    const clipped = text.length > MAX_TURN_CHARS
      ? text.slice(0, MAX_TURN_CHARS) + ' …'
      : text;
    this.turns.push({ role, content: clipped });
    if (this.turns.length > MAX_TURNS) {
      this.turns.splice(0, this.turns.length - MAX_TURNS);
    }
  }

  addUserTurn(text) {
    this._push('user', text);
  }

  addAssistantTurn(text) {
    this._push('assistant', text);
  }

  setScreenshot(dataURL, meta = null) {
    if (dataURL) this.lastScreenshot = { dataURL, meta };
  }

  getLastScreenshot() {
    return this.lastScreenshot;
  }

  hasContext() {
    return this.turns.length > 0;
  }

  /**
   * Builds the seed prompt that brings a freshly-selected model up to speed.
   * @param {string} [toProvider] display name of the new model (optional)
   */
  buildHandoffSeed(toProvider) {
    const lines = [];
    lines.push(
      "You are taking over an in-progress conversation that the user was having with a different AI assistant. " +
      "Below is the full prior context between the user (User) and that assistant (Assistant). " +
      "Read it, then BRIEFLY confirm in one short sentence that you have the context, and continue helping from here. " +
      "Do not restate the whole history back to the user."
    );

    // Build the transcript newest-last, trimming oldest turns to fit the budget.
    const rendered = [];
    let total = 0;
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i];
      const label = t.role === 'user' ? 'User' : 'Assistant';
      const line = `${label}: ${t.content}`;
      if (total + line.length > MAX_SEED_CHARS) break;
      rendered.unshift(line);
      total += line.length;
    }

    lines.push('\n[Prior Conversation]');
    lines.push(rendered.join('\n\n'));

    if (this.lastScreenshot) {
      lines.push(
        '\nThe user had also shared a screenshot of their screen earlier' +
        (this.lastScreenshot.dataURL ? ' (attached again here)' : '') +
        '. Keep it in mind for any visual/UI questions.'
      );
    }

    return lines.join('\n');
  }

  clear() {
    this.turns = [];
    this.lastScreenshot = null;
  }
}

module.exports = new ConversationMemory();
