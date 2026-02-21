export type Side = 'Buy' | 'Sell';

export type Signal =
  | { readonly action: 'BUY'; readonly price: number; readonly stopLoss: number; readonly risk: number; readonly reason?: string }
  | { readonly action: 'SELL'; readonly price: number; readonly stopLoss: number; readonly risk: number; readonly reason?: string }
  | { readonly action: 'EXIT'; readonly price: number; readonly reason?: string };
