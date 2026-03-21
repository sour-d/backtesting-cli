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
}
