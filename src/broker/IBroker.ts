import type { Signal, Side, Position, TradeEntry, Result, Candle } from '../types/index.js';

export interface IBroker {
  allocateCapital(symbols: string[], totalCapital: number): void;
  allocateCapitalForSymbol(symbol: string, amount: number): void;
  deallocateCapitalForSymbol(symbol: string): Result<number>;
  restorePosition(symbol: string, position: Position): void;
  placeOrder(symbol: string, signal: Signal & { action: 'BUY' | 'SELL' }, timestamp: number): Result<Position> | Promise<Result<Position>>;
  exitPosition(symbol: string, price: number, timestamp: number): Result<TradeEntry> | Promise<Result<TradeEntry>>;
  getPosition(symbol: string): Position | null | Promise<Position | null>;
  checkStopLoss(symbol: string, candle: Candle): TradeEntry | null | Promise<TradeEntry | null>;
  getCapital(symbol: string): number;
  getTotalCapital(): number;
  getTotalEquity(prices: ReadonlyMap<string, number>): number;
  getAllPositions(): ReadonlyMap<string, Position>;
}
