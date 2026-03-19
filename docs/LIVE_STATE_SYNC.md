# Live engine state & DB sync

## Tables

| Table | Purpose |
|-------|---------|
| `deployments` | Per-symbol deployment: `current_capital`, config, status |
| `positions` | Open position per deployment (symbol, side, qty, entry, stop) |
| `trades` | Closed round-trips (entry/exit, PnL, fees) |

## When data is written

1. **Entry (order filled)**  
   - `positions` upserted with broker position  
   - `deployments.current_capital` updated from broker pool  

2. **Exit / stop-loss**  
   - `positions` row removed  
   - `trades` insert (`StoredTrade`) with PnL/fees  
   - `deployments.current_capital` updated in `recordCompletedTrade`  

## Restart / crash recovery

1. **Restore** (`restoreFromStore`) loads active deployments, allocates broker capital, restores bot symbols, and calls `broker.restorePosition` (no-op for Bybit; position comes from exchange).

2. **Reconcile** (`reconcileExchangeStateAfterRestart`) — **live only**, after restore + deploy:  
   - Fetches open position from **Bybit** (source of truth)  
   - If exchange has a position → save/update `positions`  
   - If DB had a position but exchange does not → remove stale DB row  
   - Refreshes `deployments.current_capital` from broker  

3. **Warmup** and feed continue as before.

## In-memory vs DB

- `store.recordTrade` remains for session analytics (TradeEntry).  
- **Authoritative** open state for dashboard/API is `positions` + `deployments`.  
- Completed history is `trades`.

## Optional follow-ups

- Persist `symbolCandleCount` / last processed `dateUnix` per deployment if you need exact “resume same candle index” semantics beyond exchange+DB.  
- Retry queue if Supabase writes fail during a candle.
