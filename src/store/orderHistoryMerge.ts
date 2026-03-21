import type { OrderHistoryPatch, OrderHistoryRecord } from '../core/types.js';

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function mergeOrderHistory(
  existing: OrderHistoryRecord | null,
  patch: OrderHistoryPatch,
): OrderHistoryRecord {
  const { id, updatedAtMs, ...rest } = patch;
  const p = stripUndefined(rest as Record<string, unknown>);
  if (!existing) {
    if (!p.deploymentId || !p.symbol || !p.status) {
      throw new Error('order_history first upsert requires deploymentId, symbol, status');
    }
    return {
      id,
      updatedAtMs,
      ...p,
    } as OrderHistoryRecord;
  }
  return {
    ...existing,
    ...p,
    id,
    updatedAtMs,
  } as OrderHistoryRecord;
}
