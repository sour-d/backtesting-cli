import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndicatorBook } from '../../indicator/IndicatorBook.js';
import { Instrument } from '../../instrument/Instrument.js';
import type { InstrumentStatic } from '../../instrument/types.js';
import type { ILogger } from '../../logger/ILogger.js';
import { BacktestStore } from '../../store/BacktestStore.js';
import { TestBroker } from '../TestBroker.js';

const noopLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const spec: InstrumentStatic = {
  symbol: 'SOLUSDT',
  category: 'linear',
  tickSize: 0.01,
  stepSize: 0.1,
  minQty: 0.1,
  minNotional: 5,
  pricePrecision: 2,
  qtyPrecision: 1,
};

describe('TestBroker', () => {
  it('placeOrder applies entry and updates position', async () => {
    const store = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));
    const inst = new Instrument(spec, new IndicatorBook());
    inst.setCapitalAllocation(10_000, 10_000);
    inst.addCandle({
      dateUnix: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    const broker = new TestBroker({
      logger: noopLogger,
      store,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => inst,
    });

    await broker.placeOrder({
      instrument: inst,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
    });

    expect(inst.currentPositionQty).toBeCloseTo(0.5, 5);
    expect(inst.avgEntryPrice).toBeCloseTo(100, 5);
  });

  it('closePosition flattens position', async () => {
    const store = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));
    const inst = new Instrument(spec, new IndicatorBook());
    inst.setCapitalAllocation(10_000, 10_000);
    inst.addCandle({
      dateUnix: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    const broker = new TestBroker({
      logger: noopLogger,
      store,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => inst,
    });

    await broker.placeOrder({ instrument: inst, side: 'Buy', qty: 0.5, price: undefined });
    expect(inst.currentPositionQty).toBeGreaterThan(0);

    await broker.closePosition('SOLUSDT');
    expect(Math.abs(inst.currentPositionQty)).toBeLessThan(1e-9);
  });
});
