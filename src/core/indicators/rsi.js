import _ from "lodash";

/**
 * Calculate Relative Strength Index (RSI) using Wilder's smoothing.
 * Adds `rsi`, `rsiGain`, and `rsiLoss` to the quote.
 *
 * @param {Object} quote - Current candle (mutated)
 * @param {Array} prevQuotes - Previous candles
 * @param {number} length - RSI period (default 14)
 */
export default function calculateRSI(quote, prevQuotes, length = 14) {
  const prevQuote = _.last(prevQuotes);
  if (!prevQuote) {
    // No previous data, cannot compute
    return;
  }

  const change = quote.close - prevQuote.close;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;

  // Check if we have previous smoothed averages
  if (prevQuote.rsiGain === undefined || prevQuote.rsiLoss === undefined) {
    // Need to compute initial SMA for gains and losses over `length` periods
    // Collect the last `length` changes (including current)
    const changes = [];
    const allQuotes = [...prevQuotes, quote];
    for (let i = 1; i < allQuotes.length; i++) {
      const ch = allQuotes[i].close - allQuotes[i - 1].close;
      changes.push({
        gain: ch > 0 ? ch : 0,
        loss: ch < 0 ? -ch : 0,
      });
    }

    // We need at least `length` changes to compute the initial SMA
    if (changes.length < length) {
      // Not enough data yet
      return;
    }

    const recent = changes.slice(-length);
    const avgGain = _.meanBy(recent, "gain");
    const avgLoss = _.meanBy(recent, "loss");

    // Apply smoothing with the current gain/loss (Wilder: newAvg = ((prevAvg * (len-1)) + current) / len)
    const alpha = 1 / length;
    const smoothedGain = avgGain * (1 - alpha) + gain * alpha;
    const smoothedLoss = avgLoss * (1 - alpha) + loss * alpha;

    const rs = smoothedLoss === 0 ? 100 : smoothedGain / smoothedLoss;
    quote.rsi = 100 - 100 / (1 + rs);

    // Store smoothed averages for next iteration
    quote.rsiGain = smoothedGain;
    quote.rsiLoss = smoothedLoss;
  } else {
    // Use previous smoothed values
    const prevGain = prevQuote.rsiGain;
    const prevLoss = prevQuote.rsiLoss;
    const alpha = 1 / length;
    const smoothedGain = prevGain * (1 - alpha) + gain * alpha;
    const smoothedLoss = prevLoss * (1 - alpha) + loss * alpha;

    const rs = smoothedLoss === 0 ? 100 : smoothedGain / smoothedLoss;
    quote.rsi = 100 - 100 / (1 + rs);

    quote.rsiGain = smoothedGain;
    quote.rsiLoss = smoothedLoss;
  }
}
