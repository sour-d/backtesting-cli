/**
 * Serializes async work per `symbol` (e.g. venue sync + trade execution + reconcile).
 * Same symbol never runs two `fn` callbacks concurrently; different symbols run in parallel.
 */
export class PerSymbolMutex {
  private readonly tail = new Map<string, Promise<unknown>>();

  runExclusive<T>(symbol: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tail.get(symbol) ?? Promise.resolve();
    const next = prior.then(() => fn());
    this.tail.set(
      symbol,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}
