/** Inclusive SMA at index `i` over `period` bars (uses high[i-period+1]..high[i]). */
export function smaAt(values: readonly number[], i: number, period: number): number | undefined {
  if (i < period - 1) return undefined;
  let s = 0;
  for (let j = i - period + 1; j <= i; j++) {
    s += values[j]!;
  }
  return s / period;
}
