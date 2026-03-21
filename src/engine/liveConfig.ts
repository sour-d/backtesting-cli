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
  /** Supabase project URL (live persistence). */
  readonly supabaseUrl: string;
  /** Supabase anon or service key (live persistence). */
  readonly supabaseKey: string;
  /** Defaults to console + db when omitted */
  readonly logTargets?: readonly LogTarget[];
}
