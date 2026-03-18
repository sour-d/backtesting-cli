# Backtest comparison: old (.data_old_for_test) vs new (.data)

## Summary

**Conclusion: the refactored engine is correct.** All 622 overlapping trades (same 8 symbols) match exactly by symbol, entry time, exit time, entry price, and exit price. The only differences are in position size and dollar PnL, which is expected because of different capital allocation (see below).

---

## Data alignment

| | Old | New |
|---|-----|-----|
| **Symbols** | 9 (incl. LTCUSDT) | 8 (no LTCUSDT in run) |
| **Trades (all)** | 696 | 622 |
| **Trades (8 symbols)** | 622 (696 − 74 LTCUSDT) | 622 |

- **Trade match:** All 622 new trades have a corresponding old trade with the same `(symbol, entryTime, exitTime)` and same `entryPrice` / `exitPrice`.
- So strategy logic (when to enter/exit and at what price) is **identical**.

---

## Why totals differ

| Metric | Old (8 symbols only) | New (8 symbols) |
|--------|----------------------|------------------|
| Net PnL (after fee) | 22,809.28 | 25,671.32 |
| Per-trade quantity / PnL | Smaller | Larger |

- **Old run** was executed with 9 symbols, so capital was split 9 ways (e.g. 100k/9 ≈ 11.1k per symbol). The 8-symbol subset of trades was sized with that allocation.
- **New run** was executed with 8 symbols, so capital is split 8 ways (100k/8 = 12.5k per symbol). Same signals produce larger position sizes and thus larger absolute PnL.
- So the **direction and timing** of every trade are the same; only **size and dollar amounts** differ due to the different capital-per-symbol assumption.

---

## Per-symbol trade counts (8 symbols)

| Symbol   | Old | New |
|----------|-----|-----|
| DOGEUSDT | 78  | 78  |
| ETHUSDT  | 81  | 81  |
| SOLUSDT  | 84  | 84  |
| ADAUSDT  | 61  | 61  |
| DOTUSDT  | 74  | 74  |
| AVAXUSDT | 79  | 79  |
| BTCUSDT  | 90  | 90  |
| XRPUSDT  | 75  | 75  |
| **Total** | **622** | **622** |

---

## Stats format note

- **Old** `stats_result.json`: nested `trade` / `performance` (e.g. `accuracy`, `profitOrLossAfterFee`, `maxDrawDown`).
- **New** `stats_result.json`: flat fields (e.g. `winRate`, `netPnL`, `maxDrawdown`).
- Comparing totals must use the same symbol set (e.g. exclude LTCUSDT from old when comparing to an 8-symbol new run).
