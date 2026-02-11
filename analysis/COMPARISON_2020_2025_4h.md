# Strategy Comparison Report: MovingAverage vs BTCTrend v3-relaxed

**Timeframe:** 4-hour candles
**Capital:** $100,000 per strategy
**Universe:** 10 cryptocurrencies (BTC, ETH, SOL, ADA, DOGE, XRP, DOT, AVAX, MATIC, LTC)
**Period:** 2020–2025 (6 years)

---

## Annual Performance Table

| Year | Strategy          | Trades | P&L ($) | Return (%) | Win Rate | Avg R per Trade |
|------|-------------------|--------|---------|------------|----------|-----------------|
| 2020 | MovingAverage     | 141    | 53,153  | +53.15%    | 32.62%   | ~376            |
| 2020 | BTCTrend v3-relax | 38     | 75,469  | +75.47%    | 55.26%   | ~1,985          |
| 2021 | MovingAverage     | 1,149  | -734    | -0.73%     | 29.07%   | ~-1             |
| 2021 | BTCTrend v3-relax | 206    | 28,443  | +28.44%    | 34.47%   | ~138            |
| 2022 | MovingAverage     | 1,649  | 65,776  | +65.78%    | 29.59%   | ~40             |
| 2022 | BTCTrend v3-relax | 243    | -15,537 | -15.54%    | 20.99%   | ~-64            |
| 2023 | MovingAverage     | 1,602  | 17,927  | +17.93%    | 27.53%   | ~11             |
| 2023 | BTCTrend v3-relax | 339    | 34,846  | +34.85%    | 33.04%   | ~103            |
| 2024 | MovingAverage     | 1,580  | 67,796  | +67.80%    | 30.38%   | ~43             |
| 2024 | BTCTrend v3-relax | 316    | 30,731  | +30.73%    | 32.28%   | ~97             |
| 2025 | MovingAverage     | 1,527  | 30,033  | +30.03%    | 28.81%   | ~20             |
| 2025 | BTCTrend v3-relax | 246    | 112     | +0.11%     | 27.64%   | ~0.5            |
| 2026 | MovingAverage     | N/A    | N/A     | N/A        | N/A      | N/A             |
| 2026 | BTCTrend v3-relax | N/A    | N/A     | N/A        | N/A      | N/A             |

---

## Cumulative 6-Year Totals (2020–2025)

| Strategy          | Total P&L ($) | Total Return (%) | Avg Trades/Year | Avg Win Rate |
|-------------------|---------------|------------------|-----------------|--------------|
| MovingAverage     | 265,098       | +265.10%         | ~1,443          | 29.67%       |
| BTCTrend v3-relax | 253,924       | +253.92%         | ~282            | 34.11%       |

*Note: Cumulative return is not simply sum of annual returns because capital compounds, but these are approximate additive totals for comparison.*

---

## Year-by-Year Winners

| Year | Winner          | BTCTrend P&L | MA P&L | Margin |
|------|-----------------|--------------|--------|--------|
| 2020 | **BTCTrend**    | 75,469       | 53,153 | +22,316 |
| 2021 | **BTCTrend**    | 28,443       | -734   | +29,177 |
| 2022 | **MovingAverage** | -15,537    | 65,776 | +81,313 |
| 2023 | **BTCTrend**    | 34,846       | 17,927 | +16,919 |
| 2024 | **MovingAverage** | 30,731      | 67,796 | +37,065 |
| 2025 | **MovingAverage** | 112         | 30,033 | +29,921 |

---

## Key Observations

### 1. Regime Dependence
- **BTCTrend v3-relaxed** excels in **2020, 2021, 2023** – years with high volatility or bearish/bottoming markets.
- **MovingAverage** excels in **2022, 2024, 2025** – strong trending bull markets, and holds up well in 2025 where BTCTrend nearly broke even.

### 2. Trading Frequency
- MovingAverage executes **5–8× more trades** than BTCTrend.
- BTCTrend is highly selective (~200–300 trades/year), aiming for high R targets (8× ATR).
- MovingAverage trades frequently (~1500+/year), capturing smaller moves with SuperTrend-based entries/exits.

### 3. Win Rate & Per-Trade R
- BTCTrend maintains **higher win rates** (33–55%) due to pre-trade filters (RSI, higher-highs ratio, volume, SMA).
- MovingAverage has lower win rates (27–32%) but compensates with higher trade volume.
- BTCTrend's average R per trade is enormous in winning years (hundreds to thousands) because of 8× ATR targets. In losing years, negative R is also large.

### 4. Risk Assessment
- BTCTrend shows **higher volatility** in annual returns: +75%, -15%, +35% swings.
- MovingAverage is more consistent: +65%, -0.7%, +66%, +18%, +68%, +30% – never deeply negative except a small 2021 loss.
- BTCTrend's filters protect in choppy markets but may be **too restrictive** during strong 4h trends (e.g., 2025 only $112 profit on 246 trades).

### 5. Strategy Characteristics
- **MovingAverage:** 20-period high/low moving average + SuperTrend. Trades both long and short. Higher turnover, lower per-trade risk, responds well to sustained momentum.
- **BTCTrend v3-relaxed:** Long-only EMA crossover (12/26) + RSI > 30, plus pre-trade filters (RSI < 70, HH ratio > 0.35, ATR% < 6.5, volume < 2×). Aims for big moves. More suitable for swing/position trading.

---

## Recommendations

### 1. Regime-Switching System
Given the complementary performance, a **regime detector** could allocate capital between the two strategies based on recent market conditions:

- **Regime A (Choppy/Slow Trend):** Favor BTCTrend (2020, 2021, 2023). Indicators:
  - Low average ATR% over last N bars
  - Low ADX or low trend strength
  - Recent MovingAverage underperformance

- **Regime B (Strong Trend):** Favor MovingAverage (2022, 2024, 2025). Indicators:
  - High average ATR%
  - High ADX or strong directional moves
  - Recent MovingAverage outperformance

### 2. Adjust BTCTrend for 4h
The v3-relaxed filters were optimized for **daily** timeframe. On 4h they may be too tight. Consider:
- Reducing `minHHillRatio` from 0.35 to 0.25–0.30
- Increasing `maxATRPercent` from 6.5% to 8–9%
- Removing `requirePriceAboveSMA20` (4h trends start below SMA20 more often)

Re-test these looser filters on 2022–2025 to see if they capture more profit without sacrificing win rate.

### 3. Risk Management
- MovingAverage's huge trade count means higher transaction costs and more psychological load. Ensure these are accounted for in live trading.
- BTCTrend's occasional large losses (e.g., -$15k in 2022) require per-trade risk control and position sizing.
- Diversification across 10 symbols helps; both strategies benefit from it.

---

## 2026 Status

As of February 2026, full-year data is not yet available. Once 2026 concludes, re-run the backtests to validate whether the regime patterns hold.

---

## Data & Scripts

All backtests were run manually using:

```bash
# Example for a given year
yarn clean
node src/cli/index.js download
node src/cli/index.js run --strategy MovingAverage
cp .data/results/result.json .data/results/result_<YEAR>_4h_movingaverage.json
node src/cli/index.js run --strategy BTCTrend
cp .data/results/result.json .data/results/result_<YEAR>_4h_btctrend_v3relaxed.json
```

Configuration file: `src/config/symbols.js` (set interval to 4h, dates per year).

BTCTrend capital is set to **$100,000** in `src/core/strategy/BTCTrendStrategy.js`.

---

**Prepared on:** 2026-02-11
**Next steps:** Build regime-switching logic; adjust BTCTrend 4h parameters; add monthly drawdown analysis.
