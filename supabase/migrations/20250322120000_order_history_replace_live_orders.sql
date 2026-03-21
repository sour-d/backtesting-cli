-- Replace live_orders with order_history (lifecycle row per round-trip).
-- Safe to run on existing DB: drops live_orders, creates order_history.

DROP TABLE IF EXISTS live_orders CASCADE;

CREATE TABLE IF NOT EXISTS order_history (
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

CREATE INDEX IF NOT EXISTS idx_order_history_deployment_symbol ON order_history (deployment_id, symbol);
CREATE INDEX IF NOT EXISTS idx_order_history_status ON order_history (status);

ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_history_all" ON order_history;
CREATE POLICY "order_history_all" ON order_history FOR ALL USING (true) WITH CHECK (true);
