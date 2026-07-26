import type { Instrument } from '../../instrument/Instrument.js';

export type EngineEvent =
  | { readonly type: 'CandleClosed'; readonly instrument: Instrument }
  | { readonly type: 'ReconcileTick' };
