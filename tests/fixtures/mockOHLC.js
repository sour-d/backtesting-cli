/**
 * Generates an array of OHLC candles with a specific green/red pattern.
 *
 * @param {number} days - Number of candles to generate
 * @param {object} options
 * @param {number} options.basePrice - Starting price level (default: 100)
 * @param {string} options.pattern - String of 'G' (green) and 'R' (red) for each candle.
 *                                   Repeats if shorter than `days`.
 * @returns {object[]} Array of OHLC candle objects
 */
export function generateOHLC(days, { basePrice = 100, pattern = "GR" } = {}) {
  const candles = [];
  const spread = 2; // gap between open and close
  const wick = 1; // wick beyond the open/close range

  for (let i = 0; i < days; i++) {
    const p = pattern[i % pattern.length];
    const mid = basePrice + i * 0.5;

    let open, close;
    if (p === "G") {
      open = mid;
      close = mid + spread;
    } else {
      open = mid + spread;
      close = mid;
    }

    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;

    const dateObj = new Date(2024, 0, 1 + i); // Start Jan 1 2024
    const dateStr = dateObj.toISOString().split("T")[0];

    candles.push({
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: 1000,
      dateUnix: dateObj.getTime(),
      date: dateStr,
      time: dateObj.toISOString(),
      Date: dateStr, // Used by Trades.toCSV()
    });
  }

  return candles;
}

// -----------------------------------------------------------------------
// Pre-defined 30-candle patterns for integration tests.
//
// Layout: indices 0-18 = alternating warm-up (no 2-candle signals fire),
//         index 19    = transition candle (opposite of day 20 so day 20
//                        produces no signal),
//         indices 20-29 = trading window with predictable signals.
//
// TESTA trading window (20-29): G G R R G G R R G G
//   Expected trades: Long(21-22), Short(23-24), Long(25-26), Short(27-28), Long(29=open)
//
// TESTB trading window (20-29): R R G G R R G G R R
//   Expected trades: Short(21-22), Long(23-24), Short(25-26), Long(27-28), Short(29=open)
//
// On day 21: TESTA = BUY, TESTB = SELL  (multi-instrument isolation scenario)
// -----------------------------------------------------------------------

//                    warm-up (0-18)         19  trading (20-29)
export const TESTA_PATTERN = "GRGRGRGRGRGRGRGRGRG" + "R" + "GGRRGGRRGG";
export const TESTB_PATTERN = "RGRGRGRGRGRGRGRGRGR" + "G" + "RRGGRRGGRR";
