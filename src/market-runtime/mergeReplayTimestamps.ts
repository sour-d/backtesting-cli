/**
 * Sorted union of all replay bar timestamps across symbols.
 */
export function mergeReplayTimestamps(replayBySymbol: ReadonlyMap<string, ReadonlyMap<number, unknown>>): number[] {
  const set = new Set<number>();
  for (const m of replayBySymbol.values()) {
    for (const t of m.keys()) {
      set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}
