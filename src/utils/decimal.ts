/** Infer decimal places from a numeric string like "0.01" or "1". */
export function decimalsFromStep(step: string): number {
  const parts = step.split('.');
  if (parts.length < 2) return 0;
  return parts[1]!.replace(/0+$/, '').length;
}

export function roundToPrecision(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
