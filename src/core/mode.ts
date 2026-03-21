export type RunMode = 'live' | 'paper' | 'backtest';

export function assertModeImplemented(mode: RunMode, implemented: RunMode): void {
  if (mode !== implemented) {
    throw new Error(`Mode "${mode}" is not implemented yet`);
  }
}
