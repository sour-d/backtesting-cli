import chalk from 'chalk';
import type { ILogger, LogLevelName, LogMeta } from './ILogger.js';
import { shouldLog } from './ILogger.js';

export class ConsoleSink implements ILogger {
  constructor(
    private readonly minLevel: LogLevelName,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  private out(level: LogLevelName, message: string, meta?: LogMeta): void {
    if (!shouldLog(this.minLevel, level)) return;
    const tag =
      level === 'error'
        ? chalk.red(level.toUpperCase())
        : level === 'warn'
          ? chalk.yellow(level.toUpperCase())
          : level === 'debug'
            ? chalk.gray(level.toUpperCase())
            : chalk.cyan(level.toUpperCase());
    const rest = { ...this.bindings, ...meta };
    const suffix = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    // eslint-disable-next-line no-console
    console.log(`${tag} ${message}${suffix}`);
  }

  debug(message: string, meta?: LogMeta): void {
    this.out('debug', message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    this.out('info', message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    this.out('warn', message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    this.out('error', message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new ConsoleSink(this.minLevel, { ...this.bindings, ...bindings });
  }
}
