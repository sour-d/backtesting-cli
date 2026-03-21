import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ILogger, LogLevelName, LogMeta } from './ILogger.js';
import { shouldLog } from './ILogger.js';

export class FileSink implements ILogger {
  constructor(
    private readonly filePath: string,
    private readonly minLevel: LogLevelName,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  private async append(level: LogLevelName, message: string, meta?: LogMeta): Promise<void> {
    if (!shouldLog(this.minLevel, level)) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      ts: Date.now(),
      level,
      message,
      ...this.bindings,
      ...meta,
    });
    await appendFile(this.filePath, `${line}\n`, 'utf8');
  }

  debug(message: string, meta?: LogMeta): void {
    void this.append('debug', message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    void this.append('info', message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    void this.append('warn', message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    void this.append('error', message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new FileSink(this.filePath, this.minLevel, { ...this.bindings, ...bindings });
  }
}
