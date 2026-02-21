import type { ILogger } from './ILogger.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: '',
};

export class ConsoleLogger implements ILogger {
  private readonly context: Record<string, string>;
  private readonly minLevel: LogLevel;

  constructor(
    context: Record<string, string> = {},
    minLevel: LogLevel = LogLevel.INFO,
  ) {
    this.context = context;
    this.minLevel = minLevel;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  child(context: Record<string, string>): ILogger {
    return new ConsoleLogger(
      { ...this.context, ...context },
      this.minLevel,
    );
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const contextStr = Object.entries(this.context)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    const parts = [`[${timestamp}]`, `${label}`, contextStr, message].filter(Boolean);
    const line = parts.join(' ');

    if (data && Object.keys(data).length > 0) {
      const dataStr = JSON.stringify(data);
      this.write(level, `${line} ${dataStr}`);
    } else {
      this.write(level, line);
    }
  }

  private write(level: LogLevel, line: string): void {
    if (level >= LogLevel.ERROR) {
      console.error(line);
    } else if (level >= LogLevel.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
