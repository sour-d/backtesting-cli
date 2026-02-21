# QuantLab

A modular backtesting and live trading engine written in TypeScript. Run strategy backtests on historical data or deploy strategies in real-time with a REST API -- all from a single codebase.

## Features

- **Unified pipeline** -- the same code path handles backtesting and live trading; only the data source, broker, and storage layer swap based on mode.
- **Modular architecture** -- independent modules for data sourcing, market indicators, strategies, brokerage, storage, and deployment management.
- **REST API** -- manage live deployments at runtime (create, stop, pause, resume, update) and query data for dashboards.
- **Pluggable storage** -- file-based storage for local backtesting, Supabase for production persistence.
- **Structured logging** -- console output + optional DB persistence for live sessions.

## Quick Start

```bash
# Install dependencies
npm install

# Run a backtest
npx tsx src/cli/index.ts run -s MovingAverage_v2 -S SOLUSDT --interval 240

# Start the live engine with API server
npx tsx src/cli/index.ts live --port 3000
```

## Installation

```bash
git clone <repository-url>
cd backtesting-cli
npm install
```

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
```

### Test

```bash
npm test             # Run all tests (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable            | Required | Description                                               |
| ------------------- | -------- | --------------------------------------------------------- |
| `PORT`              | No       | API server port (default `3000`, Render.com sets this)    |
| `SUPABASE_URL`      | No       | Supabase project URL -- enables DB persistence in live mode |
| `SUPABASE_KEY`      | No       | Supabase anon or service-role key                         |
| `BYBIT_API_KEY`     | No       | Bybit API key (for live broker/feed)                      |
| `BYBIT_API_SECRET`  | No       | Bybit API secret                                          |

When `SUPABASE_URL` and `SUPABASE_KEY` are **not set**, the live engine falls back to file-based storage (`.data/` directory) -- no crash, no special flag needed.

## CLI Commands

### `quantlab run` -- Backtest

Run a strategy against historical OHLCV data stored in `.data/market/`.

```bash
npx tsx src/cli/index.ts run \
  -s MovingAverage_v2 \
  -S SOLUSDT,BTCUSDT \
  -c 100000 \
  -r 5 \
  -a 0.8 \
  --interval 240 \
  --log-level INFO
```

| Flag              | Description                          | Default      |
| ----------------- | ------------------------------------ | ------------ |
| `-s, --strategy`  | Strategy name (required)             | --           |
| `-S, --symbols`   | Comma-separated symbols              | `SOLUSDT`    |
| `-c, --capital`   | Starting capital                     | `100000`     |
| `-r, --risk`      | Risk % per trade                     | `5`          |
| `-a, --allocation`| Max allocation fraction (0-1)        | `0.8`        |
| `-f, --fee`       | Fee rate                             | `0.001`      |
| `--interval`      | Candle interval in minutes           | `240`        |
| `--start`         | Start timestamp (unix ms)            | beginning    |
| `--end`           | End timestamp (unix ms)              | now          |
| `--log-level`     | `DEBUG`, `INFO`, `WARN`, `ERROR`     | `INFO`       |

**Output:** results saved to `.data/transformedResult/t_result.json` and `.data/resultsStats/stats_result.json`.

### `quantlab live` -- Live Trading Engine

Starts the Express API server and trading engine. Strategies are deployed at runtime via the API.

```bash
npx tsx src/cli/index.ts live --port 3000 --log-level INFO
```

| Flag            | Description                          | Default |
| --------------- | ------------------------------------ | ------- |
| `--port`        | API server port                      | `3000`  |
| `--interval`    | Candle interval                      | `240`   |
| `--log-level`   | Log level                            | `INFO`  |

### `quantlab download` -- Download Data (placeholder)

```bash
npx tsx src/cli/index.ts download -S SOLUSDT --start 1700000000000 --end 1710000000000
```

## API

Full API documentation is in [docs/API.md](docs/API.md). Overview of endpoints:

### Engine Control
| Method   | Path                            | Description                 |
| -------- | ------------------------------- | --------------------------- |
| `GET`    | `/api/health`                   | Health check                |
| `GET`    | `/api/strategies`               | List available strategies   |
| `POST`   | `/api/deployments`              | Create new deployment(s)    |
| `GET`    | `/api/deployments`              | List active deployments     |
| `GET`    | `/api/deployments/:id`          | Deployment detail           |
| `DELETE` | `/api/deployments/:id`          | Stop deployment             |
| `PATCH`  | `/api/deployments/:id`          | Update deployment config    |
| `POST`   | `/api/deployments/:id/pause`    | Pause deployment            |
| `POST`   | `/api/deployments/:id/resume`   | Resume deployment           |
| `GET`    | `/api/deployments/:id/trades`   | Trades for a deployment     |

### Dashboard (Read-Only)
| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| `GET`  | `/api/dashboard/trades`         | Query trades with filters            |
| `GET`  | `/api/dashboard/trades/stats`   | Aggregated trade statistics          |
| `GET`  | `/api/dashboard/deployments`    | All deployments (incl. stopped)      |
| `GET`  | `/api/dashboard/positions`      | All open positions                   |
| `GET`  | `/api/dashboard/candles`        | Historical candle data               |
| `GET`  | `/api/dashboard/logs`           | Application logs                     |
| `GET`  | `/api/dashboard/equity`         | Equity curve (cumulative PnL)        |

## Database Setup

The live engine can use Supabase for persistence. To set up the tables:

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the schema file:

```bash
# Or copy-paste the contents of supabase/schema.sql into the SQL editor
cat supabase/schema.sql
```

The schema creates 5 tables: `deployments`, `positions`, `trades`, `candles`, and `logs`. Each `CREATE TABLE` is preceded by `DROP TABLE IF EXISTS ... CASCADE` for idempotent re-runs.

See [supabase/schema.sql](supabase/schema.sql) for the full DDL.

## Storage Modes

| Mode              | Store          | Trigger                                        |
| ----------------- | -------------- | ---------------------------------------------- |
| Backtest (`run`)  | `FileStore`    | Always                                         |
| Live (with DB)    | `SupabaseStore`| `SUPABASE_URL` + `SUPABASE_KEY` env vars set   |
| Live (no DB)      | `FileStore`    | Env vars not set -- safe fallback               |

**FileStore** writes JSON files to `.data/` (market data, aggregated results, performance stats). Live-specific operations (deployments, positions, trades) are no-ops.

**SupabaseStore** persists deployments, open positions, completed trades, batched OHLCV candles, and application logs to Postgres. Aggregated stats are not stored -- they're recomputed on demand via the dashboard API.

## Project Structure

```
src/
  api/              REST API server and route handlers
    routes/
      strategies.ts     Strategy listing
      deployments.ts    Deployment CRUD
      dashboard.ts      Read-only dashboard queries
    server.ts           Express app setup
  broker/             Broker abstraction and simulated broker
  cli/                CLI entry point (commander)
  datasource/         Data feed interfaces (historical, live)
  deployment/         DeploymentManager for runtime strategy control
  logger/             Structured logging (Console + Persistent DB logger)
  market/             OHLC storage, indicator engine, technical indicators
    indicators/       ATR, EMA, RSI, SuperTrend, Moving Averages, etc.
  store/              Persistence layer (IStore, FileStore, SupabaseStore)
  strategy/           Strategy interface and implementations
  trading-bot/        Bot orchestrator (candle processing, signal execution)
  types/              Shared TypeScript types and interfaces
supabase/
  schema.sql          Database DDL for Supabase
docs/
  API.md              Full API reference
```

## License

MIT
