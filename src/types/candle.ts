export interface Candle {
  readonly date: string;
  readonly time: string;
  readonly dateUnix: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type IndicatorValues = Readonly<Record<string, number | string>>;

export type EnrichedCandle = Candle & IndicatorValues;
