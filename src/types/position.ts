import type { Side } from './signal.js';

export interface Position {
  readonly symbol: string;
  readonly side: Side;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopLoss: number;
  readonly entryTime: number;
}
