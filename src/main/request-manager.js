const eventBus = require('./event-bus');
const stateManager = require('./state-manager');

/**
 * Request Manager
 * Prevents duplicates, queues/replaces active requests, manages timeouts.
 * Acts as the single controller for all AI interactions.
 */
class RequestManager {
  constructor() {
    this.activeRequest = null;
    
    // Listen to user submissions
    eventBus.on('userQuestionSubmitted', async (question) => {
      this.handleNewRequest(question);
    });

    eventBus.on('userRequestCancelled', () => {
      this.cancelActiveRequest();
    });

    // Auto-complete when stream finishes
    eventBus.on('streamFinished', () => {
      if (this.activeRequest) {
        console.log('[RequestManager] Stream finished, completing request:', this.activeRequest.id);
        this.completeRequest(this.activeRequest.id);
      }
    });

    // No timeout — response arrives whenever ChatGPT is ready
  }

  /**
   * Process a new request from the user
   * @param {string} question 
   */
  async handleNewRequest(question) {
    if (this.activeRequest) {
      console.log('[RequestManager] Cancelling existing request for a new one...');
      this.cancelActiveRequest();
    }

    const requestId = crypto.randomUUID();
    
    this.activeRequest = {
      id: requestId,
      status: 'pending',
      question: question
    };

    stateManager.set('currentRequest', this.activeRequest);
    eventBus.emit('requestStarted', question);
  }



  /**
   * Cancel the currently active request
   */
  cancelActiveRequest() {
    if (this.activeRequest) {
      this.activeRequest.status = 'cancelled';
      eventBus.emit('requestCancelled', this.activeRequest.id);
      this.activeRequest = null;
      stateManager.set('currentRequest', null);
    }
  }



  /**
   * Mark request as completed (called when stream finishes)
   * @param {string} requestId 
   */
  completeRequest(requestId) {
    if (this.activeRequest && this.activeRequest.id === requestId) {
      this.activeRequest.status = 'completed';
      eventBus.emit('requestCompleted', requestId);
      this.activeRequest = null;
      stateManager.set('currentRequest', null);
    }
  }
}

module.exports = new RequestManager();
