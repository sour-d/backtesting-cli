import { randomUUID } from 'node:crypto';
import type { ILogger } from './ILogger.js';
import type { IStore, LogEntry } from '../store/IStore.js';

type PersistableLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogBuffer {
  entries: LogEntry[];
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * Decorator logger that forwards all calls to an inner ILogger
 * and additionally buffers INFO/WARN/ERROR entries for batch
 * persistence to the store (DB in production).
 */
export class PersistentLogger implements ILogger {
  private readonly inner: ILogger;
  private readonly store: IStore;
  private readonly context: Record<string, string>;
  private readonly sessionId: string;
  private readonly buffer: LogBuffer;
  private readonly flushThreshold: number;

  constructor(opts: {
    inner: ILogger;
    store: IStore;
    context?: Record<string, string>;
    sessionId?: string;
    buffer?: LogBuffer;
    flushThreshold?: number;
  }) {
    this.inner = opts.inner;
    this.store = opts.store;
    this.context = opts.context ?? {};
    this.sessionId = opts.sessionId ?? randomUUID();
    this.flushThreshold = opts.flushThreshold ?? 20;

    if (opts.buffer) {
      this.buffer = opts.buffer;
    } else {
      this.buffer = { entries: [], timer: null };
      this.buffer.timer = setInterval(() => { void this.flush(); }, 5_000);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.inner.debug(message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.inner.info(message, data);
    this.capture('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.inner.warn(message, data);
    this.capture('WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.inner.error(message, data);
    this.capture('ERROR', message, data);
  }

  child(context: Record<string, string>): ILogger {
    return new PersistentLogger({
      inner: this.inner.child(context),
      store: this.store,
      context: { ...this.context, ...context },
      sessionId: this.sessionId,
      buffer: this.buffer,
      flushThreshold: this.flushThreshold,
    });
  }

  async flush(): Promise<void> {
    if (this.buffer.entries.length === 0) return;
    const batch = this.buffer.entries.splice(0);
    try {
      await this.store.saveLogBatch(batch);
    } catch {
      // Re-insert at the front so entries aren't lost on transient failure
      this.buffer.entries.unshift(...batch);
    }
  }

  dispose(): void {
    if (this.buffer.timer) {
      clearInterval(this.buffer.timer);
      this.buffer.timer = null;
    }
  }

  private capture(level: PersistableLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      level,
      component: this.context['component'] ?? '',
      message,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
      ...(Object.keys(this.context).length > 0 ? { context: this.context } : {}),
    };

    this.buffer.entries.push(entry);

    if (this.buffer.entries.length >= this.flushThreshold) {
      void this.flush();
    }
  }
}
