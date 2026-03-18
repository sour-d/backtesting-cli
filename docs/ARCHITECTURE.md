# QuantLab architecture: modules and flows

## Run modes

| Mode       | Data source   | Broker           | Store      | Logger              | Use case           |
|-----------|---------------|------------------|------------|---------------------|--------------------|
| `backtest`| Historical    | SimulatedBroker  | File       | Minimal (WARN+ Bot) | Backtest on files  |
| `paper`   | Live stream   | SimulatedBroker  | File       | Console + file      | Paper trading      |
| `live`    | Live stream   | BybitBroker      | Supabase*  | Console + DB        | Real exchange      |

\* Supabase when `SUPABASE_URL`/`SUPABASE_KEY` set; else FileStore fallback.

---

## Modules (single entry point per mode)

Each module is initialized by **mode** so the same interface behaves differently.

### 1. Broker

- **Interface:** `IBroker` (placeOrder, exitPosition, getPosition, checkStopLoss, allocateCapital, …).
- **Entry:** `createBroker(mode, config)` → `IBroker`.
  - `backtest` | `paper` → `SimulatedBroker` (in-memory capital, no real orders).
  - `live` → `BybitBroker` (real Bybit API; requires API keys).

### 2. Data source

- **Interface:** `IDataFeed` (start, stop, onCandle).
- **Entry:** `createDataFeed(mode, config)` → feed instance.
  - `backtest` → `HistoricalFeed` (load candles from store by symbol; sync by index).
  - `paper` | `live` → `LiveFeed` (Bybit kline polling, new candles pushed to handler).

### 3. Store

- **Interface:** `IStore` (market data, results, deployments, positions, trades, logs).
- **Entry:** `createStore(mode, options)` → `IStore`.
  - `backtest` → `FileStore` (read/write `.data/market`, results, stats).
  - `paper` → `FileStore` (optional clean of live data; write candles/trades/deployments to file).
  - `live` → `SupabaseStore` if env set; else `FileStore`.

### 4. Logger

- **Interface:** `ILogger` (debug, info, warn, error, child).
- **Entry:** `createLogger(mode, options)` → root `ILogger`; children (Bot, Engine, etc.) via `logger.child({ component })`.
  - `backtest` → Console only; Bot logger at WARN+ to reduce noise.
  - `paper` → Console + optional file (e.g. PersistentLogger with FileStore or console-only).
  - `live` → Console + DB (PersistentLogger with SupabaseStore when available).

### 5. Market

- Same in all modes: OHLC storage + indicator pipeline. No mode switch.

### 6. Bot

- Same in all modes: consumes feed, calls strategy, broker, store. No mode switch.

### 7. Strategy / Indicators

- Same in all modes. No mode switch.

---

## End-to-end flows

### Backtest

1. Load config (symbols, strategy, dates, capital, risk, etc.).
2. Create pipeline: `createStore('backtest')`, `createLogger('backtest')`, `createBroker('backtest')`, `createDataFeed('backtest')` (with store loadCandles).
3. Build Market from strategy indicators; Bot with broker, store, bot logger.
4. Feed.onCandle → Bot.onCandle (async); feed.start() runs historical loop.
5. After feed completes: aggregate trades, compute stats, save results/stats to store; print summary.

### Paper

1. Load config; create store (file), logger (console + optional file), broker (SimulatedBroker), BybitClient, LiveFeed.
2. Build Market, Bot; feed.onCandle → bot.onCandle + store.saveCandles.
3. DeploymentManager for API (deploy/stop/pause/resume).
4. Start LiveFeed; start API server; optional auto-deploy from config.
5. Shutdown: stop feed, flush logger, close server.

### Live

1. Same as paper but: createBroker('live') → BybitBroker; store Supabase if env set; logger with DB persistence.
2. Rest of flow identical to paper (same Bot, Market, LiveFeed, DeploymentManager).

---

## Commands (simplified)

| Command              | Mode     | Description                              |
|----------------------|----------|------------------------------------------|
| `quantlab run`       | backtest | Backtest on historical data in `.data`   |
| `quantlab live`      | paper    | Paper trading (stream + sim broker)     |
| `quantlab live --exchange` | live | Live exchange (stream + BybitBroker)      |
| `quantlab download`  | —        | Download candles from Bybit to `.data`   |

- **run:** same as today (run -s Strategy -S Symbols --start/--end, etc.).
- **live:** API server + engine; `--auto-deploy` to deploy from config on startup; `--exchange` to use real broker.
- **download:** unchanged.

---

## File layout (additions)

- `src/core/` – mode type and pipeline helpers (optional; or keep wiring in CLI).
- `src/broker/createBroker.ts` – createBroker(mode, config).
- `src/datasource/createDataFeed.ts` – createDataFeed(mode, config).
- `src/store/createStore.ts` – createStore(mode, options).
- `src/logger/createLogger.ts` – createLogger(mode, options).

CLI imports these and builds the pipeline per command (run vs live + flags).
