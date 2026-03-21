export type TradingSignal =
  | { action: 'HOLD' }
  | { action: 'CLOSE' }
  | { action: 'BUY'; qty: number; price?: number }
  | { action: 'SELL'; qty: number; price?: number };
