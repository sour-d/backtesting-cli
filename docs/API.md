# QuantLab API Reference

Base URL: `http://localhost:<PORT>` (default `3000`, configurable via `PORT` env var or `--port` flag)

All responses are JSON. Errors return `{ "error": "<message>" }`.

---

## System

### Health Check

```
GET /api/health
```

**Response**

```json
{ "status": "ok", "uptime": 1234.56 }
```

---

## Strategies

### List Available Strategies

```
GET /api/strategies
```

Returns metadata for each registered strategy, including default deployment config and tunable parameters. Useful for building dynamic forms in a dashboard.

**Response**

```json
{
  "MovingAverage": {
    "name": "MovingAverage",
    "description": "Moving average crossover strategy",
    "deploymentDefaults": {
      "capital": 100000,
      "riskPercentage": 5,
      "maxAllocation": 0.8,
      "feeRate": 0.001
    },
    "strategyParams": {
      "maPeriod": 50
    }
  }
}
```

---

## Deployments (Engine Control)

These endpoints manage live strategy deployments at runtime.

### Create Deployment

```
POST /api/deployments
```

**Request Body**

| Field            | Type       | Required | Description                                    |
| ---------------- | ---------- | -------- | ---------------------------------------------- |
| `symbols`        | `string[]` | Yes      | Symbols to trade (capital split equally)        |
| `strategy`       | `string`   | Yes      | Strategy name (from `/api/strategies`)          |
| `capital`        | `number`   | Yes      | Total capital to allocate                       |
| `riskPercentage` | `number`   | Yes      | Risk % per trade                                |
| `maxAllocation`  | `number`   | Yes      | Max fraction of capital per position (0-1)      |
| `feeRate`        | `number`   | No       | Fee rate (default `0.001`)                      |
| `strategyParams` | `object`   | No       | Strategy-specific params (e.g. `{ maPeriod: 20 }`) |

**Example**

```json
{
  "symbols": ["SOLUSDT", "BTCUSDT"],
  "strategy": "MovingAverage_v2",
  "capital": 50000,
  "riskPercentage": 3,
  "maxAllocation": 0.8,
  "strategyParams": { "maPeriod": 30 }
}
```

**Response** `201 Created`

```json
{
  "deployments": [
    {
      "id": "a1b2c3d4-...",
      "symbol": "SOLUSDT",
      "strategyName": "MovingAverage_v2",
      "config": { "capital": 25000, "riskPercentage": 3, "maxAllocation": 0.8, "feeRate": 0.001 },
      "strategyParams": { "maPeriod": 30 },
      "status": "active",
      "currentCapital": 25000,
      "createdAt": 1700000000000
    }
  ]
}
```

### List Active Deployments

```
GET /api/deployments
```

Returns in-memory active and paused deployments.

**Response**

```json
{
  "deployments": [ { "id": "...", "symbol": "SOLUSDT", "status": "active", ... } ]
}
```

### Get Deployment Detail

```
GET /api/deployments/:id
```

**Response** (includes position and PnL summary)

```json
{
  "id": "a1b2c3d4-...",
  "symbol": "SOLUSDT",
  "strategyName": "MovingAverage_v2",
  "config": { ... },
  "status": "active",
  "currentCapital": 25320,
  "position": { "symbol": "SOLUSDT", "side": "Buy", "entryPrice": 150.5, ... },
  "tradeCount": 12,
  "pnl": 320
}
```

### Stop Deployment

```
DELETE /api/deployments/:id
```

Stops the deployment and returns unused capital.

**Response**

```json
{ "success": true, "returnedCapital": 25320 }
```

### Update Deployment Config

```
PATCH /api/deployments/:id
```

**Request Body** (partial `DeploymentConfig`)

```json
{ "riskPercentage": 2, "maxAllocation": 0.6 }
```

**Response** -- updated deployment object.

### Pause Deployment

```
POST /api/deployments/:id/pause
```

**Response**

```json
{ "success": true }
```

### Resume Deployment

```
POST /api/deployments/:id/resume
```

**Response**

```json
{ "success": true }
```

### Get Deployment Trades

```
GET /api/deployments/:id/trades
```

Returns completed trades for a specific deployment.

**Response**

```json
{
  "trades": [
    {
      "id": "...",
      "deploymentId": "a1b2c3d4-...",
      "symbol": "SOLUSDT",
      "side": "Buy",
      "entryPrice": 150.5,
      "exitPrice": 155.2,
      "quantity": 10,
      "entryTime": 1700000000000,
      "exitTime": 1700010000000,
      "grossPnl": 47,
      "fee": 0.31,
      "netPnl": 46.69,
      "risk": 5,
      "result": "Profit",
      "exitType": "signal"
    }
  ]
}
```

---

## Dashboard (Read-Only)

These endpoints query persisted data for dashboards, analysis, and debugging. All query parameters are optional unless noted.

### Query Trades

```
GET /api/dashboard/trades
```

| Param          | Type     | Default | Description                           |
| -------------- | -------- | ------- | ------------------------------------- |
| `symbol`       | `string` | --      | Filter by symbol                      |
| `side`         | `string` | --      | `Buy` or `Sell`                       |
| `result`       | `string` | --      | `Profit` or `Loss`                    |
| `exitType`     | `string` | --      | `signal` or `stop_loss`               |
| `deploymentId` | `string` | --      | Filter by deployment                  |
| `from`         | `string` | --      | Start date (ISO 8601)                 |
| `to`           | `string` | --      | End date (ISO 8601)                   |
| `limit`        | `number` | `100`   | Max rows                              |
| `offset`       | `number` | `0`     | Pagination offset                     |

**Response**

```json
{
  "trades": [ { "id": "...", "symbol": "SOLUSDT", ... } ],
  "count": 42
}
```

### Trade Statistics

```
GET /api/dashboard/trades/stats
```

Computes aggregate statistics from all matching trades.

| Param          | Type     | Description                |
| -------------- | -------- | -------------------------- |
| `symbol`       | `string` | Filter by symbol           |
| `deploymentId` | `string` | Filter by deployment       |
| `from`         | `string` | Start date (ISO 8601)      |
| `to`           | `string` | End date (ISO 8601)        |

**Response**

```json
{
  "total": 120,
  "wins": 72,
  "losses": 48,
  "winRate": 60,
  "grossPnl": 15240.5,
  "totalFees": 120.3,
  "netPnl": 15120.2,
  "avgWin": 310.5,
  "avgLoss": -125.8,
  "bestTrade": 2500,
  "worstTrade": -800,
  "bySymbol": {
    "SOLUSDT": { "trades": 60, "wins": 38, "losses": 22, "netPnl": 8500 },
    "BTCUSDT": { "trades": 60, "wins": 34, "losses": 26, "netPnl": 6620.2 }
  }
}
```

### Query Deployments

```
GET /api/dashboard/deployments
```

Returns all deployments (including stopped ones), unlike `GET /api/deployments` which only returns active in-memory deployments.

| Param          | Type     | Description                             |
| -------------- | -------- | --------------------------------------- |
| `status`       | `string` | `active`, `paused`, or `stopped`        |
| `symbol`       | `string` | Filter by symbol                        |
| `strategyName` | `string` | Filter by strategy name                 |

**Response**

```json
{
  "deployments": [ { "id": "...", "status": "stopped", ... } ],
  "count": 15
}
```

### Query Open Positions

```
GET /api/dashboard/positions
```

Returns all open positions across all deployments.

**Response**

```json
{
  "positions": [
    {
      "deploymentId": "a1b2c3d4-...",
      "symbol": "SOLUSDT",
      "side": "Buy",
      "entryPrice": 150.5,
      "quantity": 10,
      "stopLoss": 145,
      "entryTime": 1700000000000
    }
  ],
  "count": 3
}
```

### Query Candles

```
GET /api/dashboard/candles
```

| Param      | Type     | Default | Description                               |
| ---------- | -------- | ------- | ----------------------------------------- |
| `symbol`   | `string` | --      | **Required.** Symbol name                 |
| `interval` | `string` | --      | **Required.** Candle interval (e.g. `240`)|
| `from`     | `string` | --      | Start unix timestamp (ms)                 |
| `to`       | `string` | --      | End unix timestamp (ms)                   |
| `limit`    | `number` | `1000`  | Max rows                                  |
| `offset`   | `number` | `0`     | Pagination offset                         |

**Response**

```json
{
  "candles": [
    { "date": "2024-01-15", "time": "08:00", "dateUnix": 1705305600000, "open": 150, "high": 155, "low": 149, "close": 153, "volume": 50000 }
  ],
  "count": 500
}
```

### Query Logs

```
GET /api/dashboard/logs
```

| Param       | Type     | Default | Description                        |
| ----------- | -------- | ------- | ---------------------------------- |
| `sessionId` | `string` | --      | Filter by engine session           |
| `level`     | `string` | --      | `INFO`, `WARN`, or `ERROR`         |
| `component` | `string` | --      | Filter by component (e.g. `Bot`)   |
| `from`      | `string` | --      | Start date (ISO 8601)              |
| `to`        | `string` | --      | End date (ISO 8601)                |
| `limit`     | `number` | `100`   | Max rows                           |
| `offset`    | `number` | `0`     | Pagination offset                  |

**Response**

```json
{
  "logs": [
    {
      "sessionId": "f47ac10b-...",
      "timestamp": "2024-01-15T08:00:00.000Z",
      "level": "INFO",
      "component": "Bot",
      "message": "Position opened",
      "data": { "symbol": "SOLUSDT", "side": "Buy" },
      "context": { "component": "Bot" }
    }
  ],
  "count": 50
}
```

### Equity Curve

```
GET /api/dashboard/equity
```

Returns cumulative PnL over time, computed from completed trades ordered by exit time.

| Param          | Type     | Description                |
| -------------- | -------- | -------------------------- |
| `symbol`       | `string` | Filter by symbol           |
| `deploymentId` | `string` | Filter by deployment       |
| `from`         | `string` | Start date (ISO 8601)      |
| `to`           | `string` | End date (ISO 8601)        |

**Response**

```json
{
  "curve": [
    { "time": 1700010000000, "cumulativePnl": 46.69 },
    { "time": 1700020000000, "cumulativePnl": -12.31 },
    { "time": 1700030000000, "cumulativePnl": 105.50 }
  ],
  "points": 3
}
```
