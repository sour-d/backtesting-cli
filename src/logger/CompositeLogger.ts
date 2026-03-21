import type { ILogger, LogMeta } from './ILogger.js';

/** Fan-out to multiple sinks — deterministic order: registration order. */
export class CompositeLogger implements ILogger {
  constructor(private readonly sinks: readonly ILogger[]) {}

  debug(message: string, meta?: LogMeta): void {
    for (const s of this.sinks) s.debug(message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    for (const s of this.sinks) s.info(message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    for (const s of this.sinks) s.warn(message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    for (const s of this.sinks) s.error(message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new CompositeLogger(this.sinks.map((s) => s.child(bindings)));
  }
}
