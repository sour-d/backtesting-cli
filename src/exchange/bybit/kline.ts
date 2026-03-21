import type { OHLCVKlineV5 } from 'bybit-api';
import type { Candle } from '../../core/types.js';

export function candleFromKlineTuple(row: OHLCVKlineV5): Candle {
  const [start, open, high, low, close, volume] = row;
  return {
    dateUnix: Number(start),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  };
}

/** V5 WS kline push item — field names vary slightly; normalize to Candle. */
export function candleFromWsKlineItem(raw: Record<string, unknown>): Candle | null {
  const start = raw.start ?? raw.startTime;
  const open = raw.open;
  const high = raw.high;
  const low = raw.low;
  const close = raw.close;
  const volume = raw.volume;
  if (
    typeof start !== 'string' &&
    typeof start !== 'number' &&
    typeof start !== 'bigint'
  ) {
    return null;
  }
  if (
    typeof open !== 'string' ||
    typeof high !== 'string' ||
    typeof low !== 'string' ||
    typeof close !== 'string' ||
    typeof volume !== 'string'
  ) {
    return null;
  }
  return {
    dateUnix: Number(start),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  };
}
