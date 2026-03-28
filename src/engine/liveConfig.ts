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
  /** Venue/registry reconcile interval (ms). Default 30_000; `0` disables periodic reconcile. */
  readonly reconcileIntervalMs?: number;
  /** Live: min ms between throttled venue position REST syncs per symbol (default 800). */
  readonly venueSyncMinIntervalMs?: number;
  /** Live: consecutive broker throws before pausing signals for that symbol (omit to disable). */
  readonly brokerFailureThreshold?: number;
  /** Ms to pause after threshold (default 60_000). */
  readonly brokerPauseCooldownMs?: number;
}
