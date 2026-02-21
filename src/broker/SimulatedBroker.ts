import type { Signal, Position, TradeEntry, Result, Candle } from '../types/index.js';
import { ok, err } from '../types/result.js';
import type { IBroker } from './IBroker.js';
import { calculateQuantity } from './riskManager.js';

export interface SimulatedBrokerConfig {
  feeRate: number;
  riskPercentage: number;
  maxAllocation: number;
}

export class SimulatedBroker implements IBroker {
  private readonly config: SimulatedBrokerConfig;
  private capitalPool: Map<string, number> = new Map();
  private positions: Map<string, Position> = new Map();
  private symbolConfigs: Map<string, { riskPercentage: number; maxAllocation: number }> = new Map();

  constructor(config: SimulatedBrokerConfig) {
    this.config = config;
  }

  allocateCapital(symbols: string[], totalCapital: number): void {
    const perSymbol = totalCapital / symbols.length;
    for (const symbol of symbols) {
      this.capitalPool.set(symbol, perSymbol);
    }
  }

  allocateCapitalForSymbol(symbol: string, amount: number): void {
    this.capitalPool.set(symbol, (this.capitalPool.get(symbol) ?? 0) + amount);
  }

  deallocateCapitalForSymbol(symbol: string): Result<number> {
    if (this.positions.has(symbol)) {
      return err(`Cannot deallocate: open position in ${symbol}`);
    }
    const remaining = this.capitalPool.get(symbol) ?? 0;
    this.capitalPool.delete(symbol);
    this.symbolConfigs.delete(symbol);
    return ok(remaining);
  }

  restorePosition(symbol: string, position: Position): void {
    this.positions.set(symbol, position);
  }

  setSymbolConfig(symbol: string, config: { riskPercentage: number; maxAllocation: number }): void {
    this.symbolConfigs.set(symbol, config);
  }

  placeOrder(symbol: string, signal: Signal & { action: 'BUY' | 'SELL' }, timestamp: number): Result<Position> {
    if (this.positions.has(symbol)) {
      return err(`Already have position in ${symbol}`);
    }

    const capital = this.getCapital(symbol);
    if (capital <= 0) return err('No capital available');

    const symConfig = this.symbolConfigs.get(symbol);
    const riskPercentage = symConfig?.riskPercentage ?? this.config.riskPercentage;
    const maxAllocation = symConfig?.maxAllocation ?? this.config.maxAllocation;

    const quantity = calculateQuantity({
      capital,
      riskPerStock: signal.risk,
      price: signal.price,
      riskPercentage,
      maxAllocation,
    });

    if (quantity <= 0) return err('Calculated quantity is zero');

    const cost = quantity * signal.price;
    this.capitalPool.set(symbol, capital - cost);

    const position: Position = {
      symbol,
      side: signal.action === 'BUY' ? 'Buy' : 'Sell',
      entryPrice: signal.price,
      quantity,
      stopLoss: signal.stopLoss,
      entryTime: timestamp,
    };

    this.positions.set(symbol, position);
    return ok(position);
  }

  exitPosition(symbol: string, exitPrice: number, timestamp: number): Result<TradeEntry> {
    const position = this.positions.get(symbol);
    if (!position) return err(`No position in ${symbol}`);

    const capital = this.getCapital(symbol);
    let proceeds: number;

    if (position.side === 'Sell') {
      proceeds = position.quantity * (2 * position.entryPrice - exitPrice);
    } else {
      proceeds = position.quantity * exitPrice;
    }

    this.capitalPool.set(symbol, capital + proceeds);
    this.positions.delete(symbol);

    const entry: TradeEntry = {
      timestamp,
      symbol,
      side: position.side,
      price: exitPrice,
      quantity: position.quantity,
      risk: 0,
      type: 'EXIT',
    };

    return ok(entry);
  }

  checkStopLoss(symbol: string, candle: Candle): TradeEntry | null {
    const position = this.positions.get(symbol);
    if (!position) return null;

    let triggered = false;
    const exitPrice = position.stopLoss;

    if (position.side === 'Buy' && candle.low <= position.stopLoss) {
      triggered = true;
    } else if (position.side === 'Sell' && candle.high >= position.stopLoss) {
      triggered = true;
    }

    if (!triggered) return null;

    const result = this.exitPosition(symbol, exitPrice, candle.dateUnix);
    if (!result.ok) return null;

    return { ...result.value, type: 'STOP_LOSS' };
  }

  getPosition(symbol: string): Position | null {
    return this.positions.get(symbol) ?? null;
  }

  getCapital(symbol: string): number {
    return this.capitalPool.get(symbol) ?? 0;
  }

  getTotalCapital(): number {
    let total = 0;
    for (const capital of this.capitalPool.values()) {
      total += capital;
    }
    return total;
  }

  getTotalEquity(prices: ReadonlyMap<string, number>): number {
    let equity = this.getTotalCapital();

    for (const [symbol, position] of this.positions) {
      const currentPrice = prices.get(symbol) ?? position.entryPrice;
      if (position.side === 'Sell') {
        equity += position.quantity * (2 * position.entryPrice - currentPrice);
      } else {
        equity += position.quantity * currentPrice;
      }
    }

    return equity;
  }

  getAllPositions(): ReadonlyMap<string, Position> {
    return this.positions;
  }
}
