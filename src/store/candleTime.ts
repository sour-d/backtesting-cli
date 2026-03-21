/**
 * Human-readable candle wall clock in IST (Asia/Kolkata) for `candles.date` / `candles.time`.
 * `date_unix` remains the canonical bar open time (exchange epoch); these columns are for display/query in the DB.
 */
export function candleDatePartsIST(dateUnix: number): { date: string; time: string } {
  const ms = dateUnix < 1e12 ? dateUnix * 1000 : dateUnix;
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const y = get('year');
  const mo = get('month');
  const day = get('day');
  const h = get('hour');
  const min = get('minute');
  const s = get('second');
  return {
    date: `${y}-${mo}-${day}`,
    time: `${h}:${min}:${s}`,
  };
}
