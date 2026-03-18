import type { RunMode } from '../core/types.js';
import type { ILogger } from './ILogger.js';
import type { IStore } from '../store/IStore.js';
import { ConsoleLogger, LogLevel } from './ConsoleLogger.js';
import { PersistentLogger } from './PersistentLogger.js';

export interface CreateLoggerOptions {
  /** Default INFO for paper/live; backtest uses WARN for Bot */
  logLevel?: keyof typeof LogLevel;
  /** For paper/live: component label for root logger */
  component?: string;
  /** For paper/live: if provided, logs are also persisted (e.g. Supabase for live) */
  store?: IStore;
  /** For live: session id for log/event correlation (e.g. same id for PersistentLogger and live_events) */
  sessionId?: string;
}

export interface CreateLoggerResult {
  /** Root logger (CLI, Engine, etc.) */
  root: ILogger;
  /** For backtest: use this for Bot to reduce noise (WARN+). For paper/live use root.child({ component: 'Bot' }) */
  botLogger: ILogger;
}

/**
 * Create logger chain for the given mode. One entry point: behavior by mode.
 * - backtest: Console only; root INFO, botLogger WARN (minimal Bot output)
 * - paper: Console only (root and botLogger from same root at INFO)
 * - live: Console + store (PersistentLogger when store provided)
 */
export function createLogger(mode: RunMode, options: CreateLoggerOptions = {}): CreateLoggerResult {
  const level = LogLevel[options.logLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
  const component = options.component ?? 'Engine';
  const store = options.store;

  if (mode === 'backtest') {
    const root = new ConsoleLogger({ component: 'CLI' }, level);
    const botLogger = new ConsoleLogger({ component: 'Bot' }, LogLevel.WARN);
    return { root, botLogger };
  }

  const consoleLogger = new ConsoleLogger({ component }, level);
  const root: ILogger = store && mode === 'live'
    ? new PersistentLogger({ inner: consoleLogger, store, context: { component }, sessionId: options.sessionId })
    : consoleLogger;
  const botLogger = root.child({ component: 'Bot' });
  return { root, botLogger };
}
