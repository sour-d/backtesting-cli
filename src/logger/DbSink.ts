import type { ILogger, LogMeta } from './ILogger.js';
import type { IStore } from '../store/IStore.js';
import { shouldLog } from './ILogger.js';
import type { LogLevelName } from './ILogger.js';

/** Persists structured rows through IStore.saveLog — async fire-and-forget. */
export class DbSink implements ILogger {
  constructor(
    private readonly store: IStore,
    private readonly minLevel: LogLevelName,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  private queue(level: LogLevelName, message: string, meta?: LogMeta): void {
    if (!shouldLog(this.minLevel, level)) return;
    void this.store
      .saveLog({
        level,
        message,
        meta: { ...this.bindings, ...meta },
        timestamp: Date.now(),
      })
      .catch(() => {
        /* avoid throwing from logger */
      });
  }

  debug(message: string, meta?: LogMeta): void {
    this.queue('debug', message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    this.queue('info', message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    this.queue('warn', message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    this.queue('error', message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new DbSink(this.store, this.minLevel, { ...this.bindings, ...bindings });
  }
}
