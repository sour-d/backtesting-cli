-- QuantLab Supabase Schema
-- Run this file to create (or recreate) all required tables.
-- WARNING: DROP TABLE CASCADE will destroy existing data.

-- ============================================================
-- 1. deployments
-- ============================================================
DROP TABLE IF EXISTS deployments CASCADE;

CREATE TABLE deployments (
  id              TEXT        PRIMARY KEY,
  symbol          TEXT        NOT NULL,
  strategy_name   TEXT        NOT NULL,
  capital         NUMERIC     NOT NULL,
  risk_pct        NUMERIC     NOT NULL,
  max_allocation  NUMERIC     NOT NULL,
  fee_rate        NUMERIC     NOT NULL DEFAULT 0.001,
  strategy_params JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'active',
  current_capital NUMERIC     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_status ON deployments (status);

-- ============================================================
-- 2. positions (one open position per deployment)
-- ============================================================
DROP TABLE IF EXISTS positions CASCADE;

CREATE TABLE positions (
  deployment_id TEXT        PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  symbol        TEXT        NOT NULL,
  side          TEXT        NOT NULL,
  entry_price   NUMERIC     NOT NULL,
  quantity      NUMERIC     NOT NULL,
  stop_loss     NUMERIC     NOT NULL,
  entry_time    TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- 3. trades (completed / closed trades)
-- ============================================================
DROP TABLE IF EXISTS trades CASCADE;

CREATE TABLE trades (
  id            TEXT        PRIMARY KEY,
  deployment_id TEXT        NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  symbol        TEXT        NOT NULL,
  side          TEXT        NOT NULL,
  entry_price   NUMERIC     NOT NULL,
  exit_price    NUMERIC     NOT NULL,
  quantity      NUMERIC     NOT NULL,
  entry_time    TIMESTAMPTZ NOT NULL,
  exit_time     TIMESTAMPTZ NOT NULL,
  gross_pnl     NUMERIC     NOT NULL,
  fee           NUMERIC     NOT NULL,
  net_pnl       NUMERIC     NOT NULL,
  risk          NUMERIC     NOT NULL,
  result        TEXT        NOT NULL,
  exit_type     TEXT        NOT NULL
);

CREATE INDEX idx_trades_deployment_exit ON trades (deployment_id, exit_time);

-- ============================================================
-- 4. candles (OHLCV market data + technical indicators)
-- ============================================================
DROP TABLE IF EXISTS candles CASCADE;

CREATE TABLE candles (
  symbol     TEXT    NOT NULL,
  interval   TEXT    NOT NULL,
  date_unix  BIGINT  NOT NULL,
  date       TEXT    NOT NULL,
  time       TEXT    NOT NULL,
  open       NUMERIC NOT NULL,
  high       NUMERIC NOT NULL,
  low        NUMERIC NOT NULL,
  close      NUMERIC NOT NULL,
  volume     NUMERIC NOT NULL,
  technicals JSONB,
  UNIQUE (symbol, interval, date_unix)
);

-- ============================================================
-- 5. logs (application logs for live sessions)
-- ============================================================
DROP TABLE IF EXISTS logs CASCADE;

CREATE TABLE logs (
  id         BIGSERIAL   PRIMARY KEY,
  session_id TEXT        NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  level      TEXT        NOT NULL,
  component  TEXT        NOT NULL DEFAULT '',
  message    TEXT        NOT NULL,
  data       JSONB,
  context    JSONB
);

CREATE INDEX idx_logs_session ON logs (session_id);
CREATE INDEX idx_logs_timestamp ON logs (timestamp);
