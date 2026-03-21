import type { KlineIntervalV3 } from 'bybit-api';

const ALLOWED = new Set<string>([
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '240',
  '360',
  '720',
  'D',
  'W',
  'M',
]);

export function parseKlineInterval(raw: string): KlineIntervalV3 {
  const trimmed = raw.trim();
  if (!ALLOWED.has(trimmed)) {
    throw new Error(`Unsupported kline interval: ${raw}`);
  }
  return trimmed as KlineIntervalV3;
}
