/**
 * Deterministic trade id for venue-driven exit rows so {@link IStore.upsertTrade} is idempotent
 * across reconcile retries (one logical exit per position round-trip).
 */
export function reconcileVenueExitTradeId(symbol: string, positionId: string): string {
  return `exit:${symbol}:${positionId}`;
}
