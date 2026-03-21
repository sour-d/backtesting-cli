import type { LinearInverseInstrumentInfoV5 } from 'bybit-api';
import type { InstrumentCategory, InstrumentStatic } from '../../instrument/types.js';
import { decimalsFromStep } from '../../utils/decimal.js';

export function linearInstrumentFromBybit(
  symbol: string,
  category: InstrumentCategory,
  info: LinearInverseInstrumentInfoV5,
): InstrumentStatic {
  const tick = info.priceFilter.tickSize;
  const step = info.lotSizeFilter.qtyStep;
  const minNotional = Number(info.lotSizeFilter.minNotionalValue ?? '0');
  return {
    symbol,
    category,
    tickSize: Number(tick),
    stepSize: Number(step),
    minQty: Number(info.lotSizeFilter.minOrderQty),
    minNotional: minNotional > 0 ? minNotional : 0,
    pricePrecision: decimalsFromStep(tick),
    qtyPrecision: decimalsFromStep(step),
  };
}
