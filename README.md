# QuantLab

Modular algorithmic trading engine in TypeScript: **live** (Bybit) and **backtest** (file market data + `TestBroker`). Paper mode is not implemented yet.

## Architecture

| Layer | Role |
|--------|------|
| **Engine** (`engine/`) | Composition root: builds `createStore`, `createLogger`, `createMarketRuntime`, `createBroker`, `createBot`, connects candle handlers, starts HTTP API. |
| **MarketRuntime** (`market-runtime/`) | Feed + warmup only: calls `instrument.addCandle` (never owns an `IndicatorBook`). Persists live bars via `IStore` after each add. |
| **Instrument** (`instrument/`) | Built in **Bot** (`fetchInstrumentStatic` from runtime + `new IndicatorBook()`). Encapsulates the book; `addCandle` updates series + indicators. |
| **IndicatorBook** (`indicator/`) | In-memory OHLCV + registered indicators (pure, no I/O). |
| **Bot** (`bot/`) | Deployments + strategy runtime; reacts to `(Instrument, EnrichedCandle)` only. |
| **Broker** (`broker/`) | Live Bybit execution + reconciliation; backtest uses `TestBroker` (instant fills + `Instrument.applyEntry`). |
| **Store** (`store/`) | `IStore` — live/paper file layout under `.data/live/` etc.; backtest writes `deployments.json`, `positions.json`, and `{SYMBOL}_{INTERVAL}.jsonl` trade lines under `.data/backtest/trades/` (reset each run). |
| **Logger** (`logger/`) | Multi-sink: console, file, optional DB via `IStore.saveLog`. |

Factories use `switch (mode)`; `paper` still throws `"not implemented"`.

## Run (backtest)

Requires `quantlab.config.js` (see `src/config/loadConfig.ts`) and per-symbol files under `.data/market/`:

- `{SYMBOL}_{INTERVAL}.json` — interval matches `quantlab.config.js` `interval` (e.g. `SOLUSDT_240.json`). Either a JSON array of candles, JSONL (one candle per line), or `{ "instrument": { ... }, "candles": [ ... ] }` with `InstrumentStatic` fields under `instrument`.
- If the market file has no `instrument` key and no `{SYMBOL}_{INTERVAL}.instrument.json` sidecar, a **generic** `InstrumentStatic` is used for backtest (see `defaultInstrumentStaticForBacktest`) — add real metadata for accurate lot/min-notional behavior.

```bash
yarn dev:backtest
# or
npm run dev:backtest
# default is --quiet (one-line summary only); full console: yarn dev:backtest:verbose
# or
npx tsx src/cli/index.ts backtest -c quantlab.config.js --data-dir .data
# optional: --warmup 200 to seed indicators with bars before `start`
```

**No trades in the log?** The engine only prints `Signal executed` / `Signal CLOSE` when the strategy returns a non-`HOLD` signal and the broker accepts the order. `MovingAverage_v2` needs enough bars for its MA(200)-style stack (`computeMav2Series` needs ~202+ candles) and strict price/SuperTrend conditions — many windows produce zero entries. Small `capital` can also make `qtyFromRisk` round to zero against `minQty` / `minNotional`. After each run, check the `Backtest run complete` line for `tradeRecords` and `.data/backtest/trades/{SYMBOL}_{INTERVAL}.jsonl` (same interval code as market files). Summarize fills with `yarn dev:insight` (reads every `*.jsonl` in that folder).

## Run (live)

```bash
cp .env.example .env   # set BYBIT_API_KEY, BYBIT_API_SECRET
npm install
npx tsx src/cli/index.ts live --port 3000 --interval 240
```

## HTTP API

- `GET /health`
- `GET /api/strategies` — registered strategy ids (`noop`, `mav2` / `MovingAverage_v2`)
- `GET /api/deployments`
- `POST /api/deployments` — `{ "symbol": "BTCUSDT", "strategyId": "noop", "capital": 1000 }`

## Environment

| Variable | Purpose |
|----------|---------|
| `BYBIT_API_KEY` / `BYBIT_API_SECRET` | Required for live trading |
| `BYBIT_TESTNET=true` | Testnet REST/WS |
| `BYBIT_DEMO=true` | Demo trading flag (Bybit SDK) |
| `PORT` | Default HTTP port |
| `KLINE_INTERVAL` | Default kline interval string (e.g. `240`) |

## Build & test

```bash
npm run build
npm test
```

## License

MIT
