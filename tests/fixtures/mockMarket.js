/**
 * Creates a plain object that satisfies the interface Bot expects from CryptoMarket.
 *
 * No file I/O, no exchange calls -- just in-memory OHLC arrays.
 *
 * @param {Record<string, object[]>} instrumentData - Map of symbol -> OHLC array
 * @param {string} interval - Candle interval label (default "D")
 * @returns {object} Mock market object
 */
export function createMockMarket(instrumentData, interval = "D") {
  // Wrap raw OHLC arrays in the { ohcl } shape that Bot.initialize() expects
  const instruments = {};
  for (const [symbol, ohlc] of Object.entries(instrumentData)) {
    instruments[symbol] = { ohcl: ohlc };
  }

  return {
    instruments,
    interval,

    isInitialized() {
      return true;
    },

    getAllInstruments() {
      return this.instruments;
    },

    getInstrument(symbol) {
      return this.instruments[symbol] || null;
    },

    getInstrumentCount() {
      return Object.keys(this.instruments).length;
    },
  };
}
