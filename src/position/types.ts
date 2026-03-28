/**
 * Snapshot of runtime position + capital for strategies (source: {@link PositionService} only).
 */
export interface PositionBookSnapshot {
  readonly currentPositionQty: number;
  readonly avgEntryPrice: number;
  readonly unrealizedPnL: number;
  readonly allocatedCapital: number;
  readonly availableCapital: number;
}

export function emptyPositionBookSnapshot(): PositionBookSnapshot {
  return {
    currentPositionQty: 0,
    avgEntryPrice: 0,
    unrealizedPnL: 0,
    allocatedCapital: 0,
    availableCapital: 0,
  };
}

/**
 * Persisted open position (Supabase + file-backed stores).
 * At most one open row per deployment (engine: one deployment per symbol).
 */
export interface PositionRecord {
  readonly id: string;
  readonly deploymentId: string;
  readonly symbol: string;
  readonly side: 'Buy' | 'Sell';
  readonly qty: number;
  readonly avgEntryPrice: number | undefined;
  readonly stopLoss: number | null;
  readonly openedAtMs: number;
  readonly updatedAtMs: number;
}
