const eventBus = require('./event-bus');

/**
 * Stream Manager
 * Buffers and dispatches streaming chunks from the Provider to the Overlay.
 * 
 * Data flow:
 *   ai-chunk IPC → BrowserProvider (rawStreamChunk) → StreamManager (buffers) → streamChunk → IPCManager → Overlay
 */
class StreamManager {
  constructor() {
    this.buffer = '';
    this.isStreaming = false;

    // Listen to RAW provider events (from BrowserProvider)
    eventBus.on('rawStreamChunk', (chunk) => this.handleChunk(chunk));
    eventBus.on('rawStreamSync', (fullText) => this.handleSync(fullText));
    eventBus.on('rawStreamFinished', (data) => this.handleFinish(data));
    eventBus.on('rawStreamError', (error) => this.handleError(error));
    
    // Listen to Request Manager
    eventBus.on('requestStarted', () => this.handleRequestStart());
    eventBus.on('requestCancelled', () => this.handleCancel());
  }

  handleRequestStart() {
    console.log('[StreamManager] Request started — resetting buffer, isStreaming=true');
    this.buffer = '';
    this.isStreaming = true;
    // Emit processed events that IPCManager catches → sends to overlay
    eventBus.emit('streamStart', { timestamp: Date.now() });
    // Show overlay (not toggle — always show when a new request starts)
    eventBus.emit('showOverlayRequested');
  }

  handleChunk(chunk) {
    if (!this.isStreaming) { console.log('[StreamManager] Ignoring chunk — not streaming'); return; }
    this.buffer += chunk;
    console.log(`[StreamManager] Chunk received (${chunk.length} chars). Buffer: ${this.buffer.length} chars total.`);
    // Emit with {fullText} so the overlay renderer can render the accumulated text
    eventBus.emit('streamChunk', { data: chunk, fullText: this.buffer });
  }

  handleSync(fullText) {
    if (!this.isStreaming) { console.log('[StreamManager] Ignoring sync — not streaming'); return; }
    this.buffer = fullText;
    console.log(`[StreamManager] Sync received. Full text: ${this.buffer.substring(0, 100)}... (${this.buffer.length} chars)`);
    // Emit empty chunk but with full text to sync the UI
    eventBus.emit('streamChunk', { data: '', fullText: this.buffer });
  }

  handleFinish(data) {
    if (!this.isStreaming) { console.log('[StreamManager] Ignoring finish — not streaming'); return; }
    this.isStreaming = false;
    
    // If the provider sends full text on complete, use it to fix any dropped chunks
    if (data && data.fullText) {
      this.buffer = data.fullText;
    }
    
    console.log(`[StreamManager] Stream FINISHED. Final buffer: ${this.buffer.substring(0, 200)}... (${this.buffer.length} chars)`);
    eventBus.emit('streamFinished', { fullText: this.buffer });
    
    // Notify Request Manager that we're done
    // Since we don't track requestId here explicitly right now, we can just let
    // the UI signal it, or let the Request Manager listen to streamFinished.
  }

  handleError(error) {
    this.isStreaming = false;
    const errorMsg = (typeof error === 'string') ? error : (error && error.message) || 'Stream error';
    console.error('[StreamManager] Error:', errorMsg);
    eventBus.emit('streamError', { error: errorMsg });
  }

  handleCancel() {
    this.isStreaming = false;
    // We don't clear the buffer, just stop updating the UI
  }
}

module.exports = new StreamManager();
