import type { Candle } from '../../types/index.js';
import type { IDataFeed, CandleHandler } from '../IDataFeed.js';

export interface HistoricalFeedConfig {
  symbols: readonly string[];
  loadCandles: (symbol: string) => Candle[] | null;
}

export class HistoricalFeed implements IDataFeed {
  private readonly config: HistoricalFeedConfig;
  private handler: CandleHandler | null = null;
  private running = false;

  constructor(config: HistoricalFeedConfig) {
    this.config = config;
  }

  onCandle(handler: CandleHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    if (!this.handler) throw new Error('No candle handler registered');
    this.running = true;

    const symbolCandles = new Map<string, Candle[]>();
    for (const symbol of this.config.symbols) {
      const candles = this.config.loadCandles(symbol);
      if (candles && candles.length > 0) {
        symbolCandles.set(symbol, candles);
      }
    }

    if (symbolCandles.size === 0) {
      throw new Error('No market data available for any symbol');
    }

    const maxLength = Math.max(
      ...Array.from(symbolCandles.values()).map((c) => c.length),
    );

    for (let i = 0; i < maxLength && this.running; i++) {
      for (const [symbol, candles] of symbolCandles) {
        const candle = candles[i];
        if (candle) {
          await Promise.resolve(this.handler!(symbol, candle));
        }
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
