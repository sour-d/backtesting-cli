export type LogMeta = Record<string, unknown> | undefined;

export interface ILogger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(bindings: Record<string, unknown>): ILogger;
}

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function shouldLog(configured: LogLevelName, msg: LogLevelName): boolean {
  return ORDER[msg] >= ORDER[configured];
}
