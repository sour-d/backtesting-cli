import type { ILogger, LogMeta } from './ILogger.js';

/** Discards all log output (e.g. backtest with `--quiet`). */
export class NullLogger implements ILogger {
  debug(_message: string, _meta?: LogMeta): void {}
  info(_message: string, _meta?: LogMeta): void {}
  warn(_message: string, _meta?: LogMeta): void {}
  error(_message: string, _meta?: LogMeta): void {}
  child(_bindings: Record<string, unknown>): ILogger {
    return this;
  }
}
