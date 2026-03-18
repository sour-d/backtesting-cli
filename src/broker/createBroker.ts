import type { RunMode } from '../core/types.js';
import type { IBroker } from './IBroker.js';
import type { ILogger } from '../logger/ILogger.js';
import { SimulatedBroker } from './SimulatedBroker.js';
import { BybitBroker } from './BybitBroker.js';

export interface BrokerOptions {
  feeRate?: number;
  riskPercentage: number;
  maxAllocation: number;
  category?: 'linear' | 'spot' | 'inverse';
  /** Required for mode 'live' */
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
  demoTrading?: boolean;
  logger?: ILogger;
}

/**
 * Create broker for the given mode. One entry point: same interface, behavior by mode.
 * - backtest | paper: SimulatedBroker (no real orders)
 * - live: BybitBroker (real Bybit API; requires apiKey/apiSecret in options)
 */
export function createBroker(mode: RunMode, options: BrokerOptions): IBroker {
  const { riskPercentage, maxAllocation, feeRate = 0.001, category = 'linear' } = options;

  if (mode === 'live') {
    const { apiKey, apiSecret, testnet, demoTrading, logger } = options;
    if (!apiKey || !apiSecret) {
      throw new Error('createBroker(mode: "live") requires apiKey and apiSecret in options');
    }
    return new BybitBroker({
      apiKey,
      apiSecret,
      testnet: testnet ?? false,
      demoTrading: demoTrading ?? false,
      config: { riskPercentage, maxAllocation, category },
      logger,
    });
  }

  return new SimulatedBroker({
    feeRate,
    riskPercentage,
    maxAllocation,
  });
}
