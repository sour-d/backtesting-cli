import type { LogLevelName } from '../logger/ILogger.js';

export interface BacktestEngineConfig {
  readonly dataDir: string;
  readonly category: 'linear' | 'spot' | 'inverse';
  readonly klineInterval: string;
  readonly warmupCandles: number;
  readonly rangeStartMs: number;
  readonly rangeEndMs: number;
  readonly feeRate: number;
  readonly logLevel: LogLevelName;
  /** When true, no console logging — full log still at `{dataDir}/backtest/logs/engine.jsonl`. */
  readonly quiet?: boolean;
}
