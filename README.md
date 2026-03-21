# QuantLab

Modular **live** algorithmic trading engine in TypeScript. Backtest and paper modes are reserved in factory APIs but not implemented yet.

## Architecture

| Layer | Role |
|--------|------|
| **Engine** (`engine/`) | Composition root: builds `createStore`, `createLogger`, `createMarketRuntime`, `createBroker`, `createBot`, connects candle handlers, starts HTTP API. |
| **MarketRuntime** (`market-runtime/`) | Feed + warmup only: calls `instrument.addCandle` (never owns an `IndicatorBook`). Persists live bars via `IStore` after each add. |
| **Instrument** (`instrument/`) | Built in **Bot** (`fetchInstrumentStatic` from runtime + `new IndicatorBook()`). Encapsulates the book; `addCandle` updates series + indicators. |
| **IndicatorBook** (`indicator/`) | In-memory OHLCV + registered indicators (pure, no I/O). |
| **Bot** (`bot/`) | Deployments + strategy runtime; reacts to `(Instrument, EnrichedCandle)` only. |
| **Broker** (`broker/`) | Live Bybit execution + reconciliation loop. |
| **Store** (`store/`) | `IStore` — file-backed JSON/JSONL under `.data/live/` (swap implementation without changing callers). |
| **Logger** (`logger/`) | Multi-sink: console, file, optional DB via `IStore.saveLog`. |

Factories use `switch (mode)` with only `live` implemented; other modes throw `"not implemented"`.

## Run (live)

```bash
cp .env.example .env   # set BYBIT_API_KEY, BYBIT_API_SECRET
npm install
npx tsx src/cli/index.ts live --port 3000 --interval 240
```

## HTTP API

- `GET /health`
- `GET /api/strategies` — registered strategy ids (default: `noop`)
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
