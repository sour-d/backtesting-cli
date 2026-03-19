import type { Position } from '../types/index.js';
import type { Side } from '../types/signal.js';

/** Hooks for persisting live trading state to DB (positions, trades, deployment capital). */
export interface ILiveDeploymentSync {
  getDeploymentId(symbol: string): string | undefined;
  onPositionOpened(symbol: string, position: Position): Promise<void>;
  onPositionClosed(symbol: string, params: LiveCloseParams): Promise<void>;
}

export interface LiveCloseParams {
  readonly side: Side;
  readonly quantity: number;
  readonly exitPrice: number;
  readonly exitTime: number;
  readonly entryPrice: number;
  readonly entryTime: number;
  readonly risk: number;
  readonly exitType: 'signal' | 'stop_loss';
}
