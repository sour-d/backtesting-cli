-- QuantLab — Supabase schema for live engine (CLI).
-- Run in Supabase SQL editor. WARNING: DROP TABLE destroys data.

DROP TABLE IF EXISTS live_events CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS live_trades CASCADE;
DROP TABLE IF EXISTS live_orders CASCADE;
DROP TABLE IF EXISTS candles CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS instrument_info CASCADE;
DROP TABLE IF EXISTS deployments CASCADE;

-- ============================================================
-- deployments (matches DeploymentState in code)
-- ============================================================
CREATE TABLE deployments (
  id               TEXT    PRIMARY KEY,
  symbol           TEXT    NOT NULL,
  strategy_id      TEXT    NOT NULL,
  capital          NUMERIC NOT NULL,
  kline_interval   TEXT,
  created_at_ms    BIGINT  NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active'
);

CREATE INDEX idx_deployments_status ON deployments (status);

-- ============================================================
-- candles (OHLCV + indicator snapshot per bar)
-- ============================================================
CREATE TABLE candles (
  symbol      TEXT    NOT NULL,
  interval    TEXT    NOT NULL,
  date_unix   BIGINT  NOT NULL,
  date        TEXT    NOT NULL,
  time        TEXT    NOT NULL,
  open        NUMERIC NOT NULL,
  high        NUMERIC NOT NULL,
  low         NUMERIC NOT NULL,
  close       NUMERIC NOT NULL,
  volume      NUMERIC NOT NULL,
  technicals  JSONB,
  UNIQUE (symbol, interval, date_unix)
);

CREATE INDEX idx_candles_symbol_interval ON candles (symbol, interval);

-- ============================================================
-- live_trades (TradeRecord — entry / exit / reconcile)
-- ============================================================
CREATE TABLE live_trades (
  id            TEXT    PRIMARY KEY,
  symbol        TEXT    NOT NULL,
  side          TEXT    NOT NULL,
  qty           NUMERIC NOT NULL,
  price         NUMERIC NOT NULL,
  fee           NUMERIC NOT NULL,
  timestamp_ms  BIGINT  NOT NULL,
  kind          TEXT    NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_trades_symbol ON live_trades (symbol);
CREATE INDEX idx_live_trades_ts ON live_trades (timestamp_ms);

-- ============================================================
-- live_orders (OrderRecord)
-- ============================================================
CREATE TABLE live_orders (
  id             TEXT    PRIMARY KEY,
  symbol         TEXT    NOT NULL,
  side           TEXT    NOT NULL,
  qty            TEXT    NOT NULL,
  price          TEXT,
  order_type     TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  created_at_ms  BIGINT  NOT NULL,
  raw            JSONB
);

-- ============================================================
-- logs (DbSink / saveLog)
-- ============================================================
CREATE TABLE logs (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT        NOT NULL DEFAULT 'live',
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  level       TEXT        NOT NULL,
  component   TEXT        NOT NULL DEFAULT 'quantlab',
  message     TEXT        NOT NULL,
  data        JSONB,
  context     JSONB
);

CREATE INDEX idx_logs_session ON logs (session_id);
CREATE INDEX idx_logs_timestamp ON logs (timestamp);
CREATE INDEX idx_logs_level ON logs (level);

-- ============================================================
-- Row Level Security — permissive policies for anon key (tighten in production)
-- ============================================================
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployments_all" ON deployments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "candles_all" ON candles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "live_trades_all" ON live_trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "live_orders_all" ON live_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "logs_all" ON logs FOR ALL USING (true) WITH CHECK (true);
