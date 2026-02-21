export type Mode = 'backtest' | 'live';

export interface AppConfig {
  readonly mode: Mode;
  readonly start: number;
  readonly end: number;
  readonly interval: string;
  readonly instruments: readonly string[];
  readonly strategy: string;
  readonly capital: number;
  readonly riskPercentage: number;
  readonly maxAllocation: number;
  readonly feeRate: number;
}
