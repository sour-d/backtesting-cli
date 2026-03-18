/**
 * Run mode: selects broker, data source, store, and logger behavior.
 * - backtest: historical file data, simulated broker, file store, minimal logging
 * - paper: live stream, simulated broker, file store, console (and optional file) logging
 * - live: live stream, real Bybit broker, Supabase or file store, console + DB logging
 */
export type RunMode = 'backtest' | 'paper' | 'live';
