export type InstrumentCategory = 'linear' | 'spot' | 'inverse';

export interface InstrumentStatic {
  readonly symbol: string;
  readonly category: InstrumentCategory;
  readonly tickSize: number;
  readonly stepSize: number;
  readonly minQty: number;
  readonly minNotional: number;
  readonly pricePrecision: number;
  readonly qtyPrecision: number;
}
