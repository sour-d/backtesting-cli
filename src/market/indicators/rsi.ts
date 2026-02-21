import type { IndicatorFn } from './types.js';
import { numOrUndefined, prev } from './utils.js';

export function rsi(period = 14): IndicatorFn {
  const alpha = 1 / period;

  return (candles, index): Record<string, number | string> => {
    const c = candles[index];
    if (!c) return {};

    const last = prev(candles, index);
    if (!last) return {};

    const change = c.close - last.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    const prevGain = numOrUndefined((last as Record<string, unknown>)['rsiGain']);
    const prevLoss = numOrUndefined((last as Record<string, unknown>)['rsiLoss']);

    if (prevGain !== undefined || prevLoss !== undefined) {
      const smoothedGain = (prevGain ?? 0) * (1 - alpha) + gain * alpha;
      const smoothedLoss = (prevLoss ?? 0) * (1 - alpha) + loss * alpha;
      const rs = smoothedLoss === 0 ? 100 : smoothedGain / smoothedLoss;
      return {
        rsi: 100 - 100 / (1 + rs),
        rsiGain: smoothedGain,
        rsiLoss: smoothedLoss,
      };
    }

    if (index < period) return {};

    const start = index - period + 1;
    let totalGain = 0;
    let totalLoss = 0;
    for (let i = start; i <= index; i++) {
      const current = candles[i];
      const previous = candles[i - 1];
      if (!current || !previous) continue;
      const ch = current.close - previous.close;
      totalGain += ch > 0 ? ch : 0;
      totalLoss += ch < 0 ? -ch : 0;
    }

    const avgGain = totalGain / period;
    const avgLoss = totalLoss / period;
    const smoothedGain = avgGain * (1 - alpha) + gain * alpha;
    const smoothedLoss = avgLoss * (1 - alpha) + loss * alpha;
    const rs = smoothedLoss === 0 ? 100 : smoothedGain / smoothedLoss;

    return {
      rsi: 100 - 100 / (1 + rs),
      rsiGain: smoothedGain,
      rsiLoss: smoothedLoss,
    };
  };
}
