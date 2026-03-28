import type { IBroker } from './IBroker.js';

/** Resolves taker/maker fee rate for `symbol` with a safe fallback. */
export async function resolveBrokerFeeRate(
  broker: IBroker,
  symbol: string,
  defaultFee: number,
): Promise<number> {
  try {
    const r = await broker.getFeeRate?.(symbol);
    if (typeof r === 'number' && Number.isFinite(r) && r >= 0) {
      return r;
    }
  } catch {
    /* fall through */
  }
  return defaultFee;
}
