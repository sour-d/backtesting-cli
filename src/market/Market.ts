import type { Candle, EnrichedCandle } from '../types/index.js';
import type { IndicatorFn } from './indicators/types.js';
import { OHLCStorage } from './OHLCStorage.js';
import { enrichAll, enrichSingle } from './indicatorPipeline.js';

export class Market {
  private readonly indicators: readonly IndicatorFn[];
  private readonly stocks: Map<string, OHLCStorage> = new Map();
  private readonly histories: Map<string, EnrichedCandle[]> = new Map();

  constructor(indicators: readonly IndicatorFn[]) {
    this.indicators = indicators;
  }

  registerSymbol(symbol: string, historicalCandles?: readonly Candle[]): void {
    const enriched = historicalCandles
      ? enrichAll(historicalCandles, this.indicators)
      : [];

    this.histories.set(symbol, enriched);
    this.stocks.set(symbol, new OHLCStorage(enriched, 0, symbol));
  }

  update(symbol: string, candle: Candle): EnrichedCandle {
    let history = this.histories.get(symbol);
    if (!history) {
      history = [];
      this.histories.set(symbol, history);
    }

    const enriched = enrichSingle(history, candle, this.indicators);

    let stock = this.stocks.get(symbol);
    if (!stock) {
      stock = new OHLCStorage(history, 0, symbol);
      this.stocks.set(symbol, stock);
    } else {
      stock.append(enriched);
    }

    return enriched;
  }

  getStock(symbol: string): OHLCStorage {
    const stock = this.stocks.get(symbol);
    if (!stock) throw new Error(`Symbol ${symbol} not registered in market`);
    return stock;
  }

  getSymbols(): string[] {
    return [...this.stocks.keys()];
  }

  hasSymbol(symbol: string): boolean {
    return this.stocks.has(symbol);
  }
}
