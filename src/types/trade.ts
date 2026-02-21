import type { Side } from './signal.js';

export interface TradeEntry {
  readonly timestamp: number;
  readonly symbol: string;
  readonly side: Side;
  readonly price: number;
  readonly quantity: number;
  readonly risk: number;
  readonly type: 'ENTRY' | 'EXIT' | 'STOP_LOSS';
}

export interface AggregatedTrade {
  readonly id: number;
  readonly symbol: string;
  readonly side: Side;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly durationCandles: number;
  readonly grossPnL: number;
  readonly fee: number;
  readonly netPnL: number;
  readonly risk: number;
  readonly rewardRatio: number;
  readonly result: 'Profit' | 'Loss';
  readonly runningCapital: number;
  readonly drawdown: number;
  readonly drawdownDuration: number;
}

export interface PerformanceStats {
  readonly totalTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly totalPnL: number;
  readonly totalFees: number;
  readonly netPnL: number;
  readonly averageReward: number;
  readonly averageWinReward: number;
  readonly averageLossReward: number;
  readonly maxReward: number;
  readonly minReward: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownDuration: number;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly averageDurationCandles: number;
  readonly longs: number;
  readonly longsWon: number;
  readonly shorts: number;
  readonly shortsWon: number;
}
