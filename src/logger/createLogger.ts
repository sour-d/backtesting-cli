import { join } from 'node:path';
import type { RunMode } from '../core/mode.js';
import type { IStore } from '../store/IStore.js';
import { CompositeLogger } from './CompositeLogger.js';
import { ConsoleSink } from './ConsoleSink.js';
import { DbSink } from './DbSink.js';
import { FileSink } from './FileSink.js';
import { NullLogger } from './NullLogger.js';
import type { ILogger, LogLevelName } from './ILogger.js';

export type LogTarget = 'console' | 'file' | 'db';

export interface CreateLoggerConfig {
  readonly mode: RunMode;
  readonly logLevel: LogLevelName;
  readonly targets: readonly LogTarget[];
  readonly baseDir?: string;
  /** Required when `db` target is enabled */
  readonly store?: IStore;
}

/**
 * Logger factory — composes sinks from config.
 * Live defaults: console + file (handled by caller presets).
 */
export function createLogger(config: CreateLoggerConfig): ILogger {
  const baseDir = config.baseDir ?? '.data';
  const level = config.logLevel;
  const sinks: ILogger[] = [];

  switch (config.mode) {
    case 'live':
    case 'backtest':
      break;
    case 'paper':
      throw new Error('createLogger: mode "paper" is not implemented yet');
    default: {
      const _e: never = config.mode;
      return _e;
    }
  }

  for (const t of config.targets) {
    if (t === 'console') {
      sinks.push(new ConsoleSink(level));
    } else if (t === 'file') {
      const logFile =
        config.mode === 'backtest'
          ? join(baseDir, 'backtest', 'logs', 'engine.jsonl')
          : join(baseDir, 'logs', 'engine.jsonl');
      sinks.push(new FileSink(logFile, level));
    } else if (t === 'db') {
      if (!config.store) {
        throw new Error('createLogger: "db" target requires store in config');
      }
      sinks.push(new DbSink(config.store, level));
    }
  }

  if (sinks.length === 0) {
    return new NullLogger();
  }
  if (sinks.length === 1) {
    return sinks[0]!;
  }
  return new CompositeLogger(sinks);
}
