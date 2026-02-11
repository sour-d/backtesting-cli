# BTCTrend v3-relaxed 2026 Partial Underperformance Analysis

**Period:** 2026-01-01 to 2026-02-10 (4h timeframe)
**Capital:** $100,000
**Result:** -$6,115.88 (-6.12%), 3 winning trades, 25 losing trades (10.7% win rate)

---

## What Happened

BTCTrend v3-relaxed suffered significant losses in early 2026, in stark contrast to MovingAverage's +7.98% return during the same period.

### Trade Entry Profile

Most entries occurred between **January 4–15** and **January 27–29**, with characteristics:

- **RSI at entry:** predominantly 65–70 (near the 70 upper limit)
- **Price vs SMA20:** mostly above SMA20 (condition passed)
- **EMA12 > EMA26:** true (bullish cross)
- **HH ratio > 0.35:** passed (implied by trade execution)
- **ATR%:** mostly below 6.5% (filter passed)

### Representative Losing Trades

| Symbol | Entry Date | Entry Price | Exit Price | RSI Entry | Outcome |
|--------|------------|-------------|------------|-----------|---------|
| BTC    | 2026-01-06 | 93,207.7    | 91,357.0   | 69.13     | -1.9%   |
| ETH    | 2026-01-06 | 3,222.0     | 3,111.97   | 66.44     | -3.4%   |
| DOGE   | 2026-01-06 | 0.14945     | 0.14126    | 67.14     | -5.5%   |
| XRP    | 2026-01-06 | 2.2271      | 2.0766     | 59.56     | -6.8%   |
| AVAX   | 2026-01-06 | 14.175      | 13.597     | 69.56     | -4.1%   |
| LTC    | 2026-01-04 | 82.11       | 80.88      | 69.79     | -1.5%   |
| SOL    | 2026-01-04 | 133.47      | 136.20     | 67.98     | +2.0%   (one of 3 wins) |

All losing trades were stopped out by the ATR-based stop (2× ATR). In many cases, the price reversed within 1–3 candles after entry.

---

## Market Regime in Early 2026

### Price Action

- **BTC:** rallied from ~91k to ~94k in early January, then dropped to ~88k by Jan 19 (~6% correction). Later recovered to ~89k by end of period.
- **ETH:** similar pattern: 3k → 3.2k → 2.8k → 3.0k
- **Altcoins:** correlated, with heightened volatility

The market exhibited:

- **High volatility** (ATR values large in dollar terms, but ATR% still under 6.5% for most symbols)
- **Short-term exhaustion moves** – entries occurred right at local peaks before corrections
- **Choppy/mean-reverting behavior** – strong intraday reversals, no sustained 4-hourly trends

### Why BTCTrend Filters Failed

1. **RSI threshold too high (70)**
   - Entries with RSI 65–70 on 4h are often at **short-term overbought** levels, especially after a quick pump. Price then pulls back, hitting stop.
   - In a choppy market, RSI can stay above 60 for extended periods without a strong trend emerging.

2. **HH ratio > 0.35 insufficiently selective**
   - Even in a consolidation, a 10-day window can produce a HH ratio > 0.35 simply due to noise.
   - The filter does not measure **trend strength** (e.g., ADX, slope of MA).

3. **SMA20 filter possibly detrimental**
   - Requiring price > SMA20 causes entries **above a moving average that is flattening** in a consolidation. Price often touches SMA20 and then drops further.

4. **No volatility regime adjustment**
   - maxATRPercent 6.5% was satisfied (ATR% was lower). But the market's **true range volatility** was high relative to expected move, causing frequent stopouts.

5. **Long-only bias**
   - MovingAverage trades both long and short; in a correcting market, short trades can profit. BTCTrend only goes long, making it fully exposed to corrections.

---

## Comparison: Why MovingAverage Performed Better

MovingAverage strategy uses:

- 20-period high/low channel (dynamic support/resistance)
- SuperTrend (ATR-based trend filter)
- Trades both long and short

In early 2026, MovingAverage likely caught some **short trades** during corrections, offsetting long losses. Its entries are based on **breaking the recent channel**, which is a more direct trend signal than RSI + HH ratio. Additionally, its stop is usually tighter (SuperTrend stop), so losses are smaller. The result: +7.98% with 33.8% win rate vs BTCTrend's -6.12% with 10.7% win rate.

---

## Recommendations for BTCTrend 4h

### 1. Tighten RSI filter
- Change `rsiMax` from 70 to **65** for 4h timeframe.
- Alternatively, add `rsiEntry` band: e.g., RSI between 35 and 65 (avoid both oversold and overbought).

### 2. Make HH ratio stricter
- Increase `minHHillRatio` from 0.35 to **0.45–0.50** on 4h. This ensures only stronger upward structures qualify.

### 3. Remove or relax SMA20 filter
- Consider `requirePriceAboveSMA20: false` for 4h, or switch to **price > SMA50** (more stable).

### 4. Add a trend-strength filter
- Require **ADX(14) > 25** to confirm trend strength (only available if we add ADX indicator).
- Or require EMA12 slope positive over last 3 bars.

### 5. Reduce position size in high-volatility regimes
- Introduce volatility scaling: if ATR% > 5%, reduce risk from 10% to 5%.
- Or use ATR-based position sizing already does that indirectly, but max stop distance may need adjustment.

### 6. Consider short trades
- Implement a separate short-side strategy or allow BTCTrend to go short when EMA12 < EMA26 and RSI < 70 (but other filters reversed). This would hedge corrections.

### 7. Regime-switching
- Use a **regime detector** to switch between BTCTrend (for trending markets) and MovingAverage (for strong trends) or even a cash position when whipsaw risk is high.
- Simple regime rule: if average ATR% over last 20 bars > 8%, switch to MovingAverage; else use BTCTrend. Or compute the **Keltner Channel width** or **Bollinger Bandwidth**.

---

## Action Items

1. **Re-test BTCTrend with tighter filters** on 2026 partial and other years to see if the -6% loss turns positive.
2. **Monitor 2026 full-year** to see if the regime persists or if a strong trend emerges later (where BTCTrend might catch up).
3. **Build a combined system** that allocates capital based on recent performance of each strategy (e.g., 60/40 split that rebalances monthly).
4. **Add drawdown tracking** to understand max loss per trade and per month.

---

**Prepared:** 2026-02-11
**Based on:** result_2026_partial_4h_btctrend_v3relaxed.json (28 closed trades, 3 wins, 25 losses)
