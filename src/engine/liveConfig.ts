import type { LogLevelName } from '../logger/ILogger.js';
import type { LogTarget } from '../logger/createLogger.js';

export interface LiveEngineConfig {
  readonly port: number;
  readonly dataDir: string;
  readonly category: 'linear' | 'spot' | 'inverse';
  readonly klineInterval: string;
  readonly warmupCandles: number;
  readonly testnet: boolean;
  readonly demoTrading: boolean;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly logLevel: LogLevelName;
  /** Defaults to console + file when omitted */
  readonly logTargets?: readonly LogTarget[];
}
