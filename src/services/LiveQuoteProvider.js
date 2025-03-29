class LiveQuoteProvider {
  listeners = new Map();

  constructor() {
    this.listeners.set("Quote", []);
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => listener(data));
    }
  }
}

export default LiveQuoteProvider;

/**
 * @typedef {Object} LiveQuoteObj
 * @property {string} id - Quote identifier
 * @property {string} symbol - Trading symbol
 * @property {string} timeFrame - Time frame of the quote
 * @property {Object} tick - The quote data
 */
