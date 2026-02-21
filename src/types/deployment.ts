import type { Side } from './signal.js';
import type { Position } from './position.js';

export interface DeploymentConfig {
  readonly capital: number;
  readonly riskPercentage: number;
  readonly maxAllocation: number;
  readonly feeRate: number;
}

export interface Deployment {
  readonly id: string;
  readonly symbol: string;
  readonly strategyName: string;
  readonly config: DeploymentConfig;
  readonly strategyParams: Readonly<Record<string, number>>;
  status: 'active' | 'paused' | 'stopped';
  currentCapital: number;
  readonly createdAt: number;
}

export interface DeployRequest {
  readonly symbols: readonly string[];
  readonly strategy: string;
  readonly capital: number;
  readonly riskPercentage: number;
  readonly maxAllocation: number;
  readonly feeRate?: number;
  readonly strategyParams?: Record<string, number>;
}

export interface DeploymentInfo extends Deployment {
  readonly position: Position | null;
  readonly tradeCount: number;
  readonly pnl: number;
}

export interface StoredTrade {
  readonly id: string;
  readonly deploymentId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly grossPnl: number;
  readonly fee: number;
  readonly netPnl: number;
  readonly risk: number;
  readonly result: 'Profit' | 'Loss';
  readonly exitType: 'signal' | 'stop_loss';
}
