-- QuantLab — Supabase schema for live engine (CLI).
-- Run in Supabase SQL editor. WARNING: DROP TABLE destroys data.

DROP TABLE IF EXISTS live_events CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS live_trades CASCADE;
DROP TABLE IF EXISTS live_orders CASCADE;
DROP TABLE IF EXISTS order_history CASCADE;
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
-- positions (open position per deployment — FK CASCADE on deployment delete)
-- ============================================================
CREATE TABLE positions (
  id                 TEXT    PRIMARY KEY,
  deployment_id      TEXT    NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  symbol             TEXT    NOT NULL,
  side               TEXT    NOT NULL,
  qty                NUMERIC NOT NULL,
  avg_entry_price    NUMERIC,
  stop_loss          NUMERIC,
  opened_at_ms       BIGINT  NOT NULL,
  updated_at_ms      BIGINT  NOT NULL,
  UNIQUE (deployment_id)
);

CREATE INDEX idx_positions_symbol ON positions (symbol);
CREATE INDEX idx_positions_deployment ON positions (deployment_id);

-- ============================================================
-- candles (OHLCV + indicator snapshot per bar)
-- date / time = wall clock in Asia/Kolkata (IST) for display; date_unix is canonical bar open (sec or ms).
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
-- order_history (one row per round-trip; same id as positions.id while open)
-- ============================================================
CREATE TABLE order_history (
  id                    TEXT    PRIMARY KEY,
  deployment_id         TEXT    NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  symbol                TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'open',
  entry_side            TEXT,
  entry_qty             NUMERIC,
  entry_price           NUMERIC,
  entry_order_type      TEXT,
  venue_entry_order_id  TEXT,
  entry_at_ms           BIGINT,
  entry_fee             NUMERIC,
  entry_timestamp_ms    BIGINT,
  stop_loss             NUMERIC,
  venue_exit_order_id   TEXT,
  exit_at_ms            BIGINT,
  exit_qty              NUMERIC,
  exit_price            NUMERIC,
  exit_fee              NUMERIC,
  exit_timestamp_ms     BIGINT,
  updated_at_ms         BIGINT  NOT NULL,
  raw                   JSONB
);

CREATE INDEX idx_order_history_deployment_symbol ON order_history (deployment_id, symbol);
CREATE INDEX idx_order_history_status ON order_history (status);

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
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployments_all" ON deployments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "positions_all" ON positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "candles_all" ON candles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "order_history_all" ON order_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "logs_all" ON logs FOR ALL USING (true) WITH CHECK (true);
