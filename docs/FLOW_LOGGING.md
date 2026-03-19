# End-to-end flow logging

All flow-related log entries include a **`flow`** field in their `data` (or `payload`). Use it to filter and reconstruct the full path for a symbol/candle.

## Flow phases (in order)

| `flow` value | When | Where |
|--------------|------|--------|
| `candle_received` | New candle from WebSocket | LiveFeed |
| `candle_enriched` | After indicators applied (market.update) | Bot |
| `strategy_eval` | Before strategy.evaluate (DEBUG) | Bot |
| `strategy_signal` | Signal or no signal (DEBUG when null) | Bot |
| `stop_loss_triggered` | Stop-loss hit, exit executed | Bot |
| `order_place_request` | About to call broker.placeOrder (params) | Bot |
| `broker_place_order` | Broker submitting order to exchange | BybitBroker |
| `broker_place_order_result` | Exchange response (success/fail) | BybitBroker |
| `order_place_result` | Bot: order placed or failed | Bot |
| `trade_recorded` | In-memory trade (ENTRY/EXIT/STOP_LOSS) | Bot |
| `exit_request` | About to call broker.exitPosition | Bot |
| `broker_exit_request` | Broker submitting close order | BybitBroker |
| `broker_exit_result` | Exchange response (success/fail) | BybitBroker |
| `exit_result` | Bot: exit success or failed | Bot |
| `trade_saved` | StoredTrade written to DB (trades table) | DeploymentManager |
| `candle_persisted` | Enriched candle written to store (candles table) | CLI handler |

## Example: trace one candle

Filter logs where `data.flow` is one of the above and `data.symbol` = `SOLUSDT`, ordered by timestamp. That gives you:

1. **candle_received** – raw candle (date, time, o, h, l, c, volume)
2. **candle_enriched** – indicators applied, candleCount
3. **strategy_eval** (DEBUG) – hasPosition, positionSide
4. **strategy_signal** – either no signal (DEBUG) or action, price, reason, stopLoss, risk
5. If EXIT: **exit_request** → **broker_exit_request** → **broker_exit_result** → **exit_result** → **trade_recorded**
6. If BUY/SELL: **order_place_request** → **broker_place_order** → **broker_place_order_result** → **order_place_result** → **trade_recorded**
7. **candle_persisted** – candle saved to DB
8. If a completed trade is persisted: **trade_saved** (id, deploymentId, symbol, side, entry/exit price, quantity, netPnl, result, exitType)

## Log level

- **INFO**: candle_received, candle_enriched, strategy_signal (when not null), all request/result and trade_recorded/trade_saved/candle_persisted.
- **DEBUG**: strategy_eval, strategy_signal when null (no signal). Set `--log-level DEBUG` to see these.

## Querying in Supabase

```sql
-- Recent flow entries for a symbol
SELECT id, timestamp, level, component, message, data
FROM logs
WHERE data->>'flow' IS NOT NULL
  AND data->>'symbol' = 'SOLUSDT'
ORDER BY timestamp DESC
LIMIT 100;
```

Or use the CLI:

```bash
quantlab logs -n 200
```

Then filter by `flow` and `symbol` in the printed JSON.
