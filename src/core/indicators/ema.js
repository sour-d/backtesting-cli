import _ from "lodash";

/**
 * Calculate Exponential Moving Average (EMA)
 * Adds property `ema{length}` to the quote.
 *
 * @param {Object} quote - Current candle (will be mutated)
 * @param {Array} prevQuotes - Array of previous candles
 * @param {number} length - EMA period
 */
export default function calculateEMA(quote, prevQuotes, length) {
  const emaKey = `ema${length}`;
  const k = 2 / (length + 1);
  const lastQuote = _.last(prevQuotes);

  if (lastQuote && lastQuote[emaKey] !== undefined) {
    // EMA = (close * k) + (prevEMA * (1 - k))
    quote[emaKey] = quote.close * k + lastQuote[emaKey] * (1 - k);
  } else {
    // Not enough history: use Simple Moving Average of available closes (including current)
    const quotes = [...prevQuotes, quote].slice(-length);
    if (quotes.length >= length) {
      const sum = _.sumBy(quotes, (q) => q.close);
      quote[emaKey] = sum / length;
    } else {
      // Fallback: just use current close (not ideal but won't crash)
      quote[emaKey] = quote.close;
    }
  }
}
