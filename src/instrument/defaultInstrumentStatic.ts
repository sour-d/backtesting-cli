import type { InstrumentCategory, InstrumentStatic } from './types.js';

/**
 * Used when backtest market files omit exchange metadata.
 * Sizing may not match the live venue — override via `instrument` in the market JSON or `{symbol}_{interval}.instrument.json`.
 */
export function defaultInstrumentStaticForBacktest(
  symbol: string,
  category: InstrumentCategory,
): InstrumentStatic {
  return {
    symbol,
    category,
    tickSize: 0.01,
    stepSize: 0.1,
    minQty: 0.1,
    minNotional: 5,
    pricePrecision: 4,
    qtyPrecision: 3,
  };
}
