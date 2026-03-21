import type { EnrichedCandle } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { InstrumentStatic } from '../instrument/types.js';

export type CandleHandler = (instrument: Instrument, candle: EnrichedCandle) => void | Promise<void>;

export interface IMarketRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Exchange REST — used by Bot to build {@link Instrument} before registration. */
  fetchInstrumentStatic(symbol: string): Promise<InstrumentStatic>;
  /** Warmup + WS subscription; runtime never constructs {@link Instrument}. */
  registerInstrument(instrument: Instrument): Promise<void>;
  unregisterInstrument(symbol: string): Promise<void>;
  onCandle(handler: CandleHandler): void;
  getInstrument(symbol: string): Instrument | undefined;
}
