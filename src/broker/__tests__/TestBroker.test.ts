import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Instrument } from '../../instrument/Instrument.js';
import type { InstrumentStatic } from '../../instrument/types.js';
import type { ILogger } from '../../logger/ILogger.js';
import { PositionManager } from '../../position/PositionManager.js';
import type { IStore } from '../../store/IStore.js';
import { BacktestStore } from '../../store/BacktestStore.js';
import { FileStore } from '../../store/FileStore.js';
import type { IBroker } from '../IBroker.js';
import { TestBroker } from '../TestBroker.js';

const noopLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const stubBroker = {
  placeOrder: async () => {},
  closePosition: async () => {},
  updateStopLoss: async () => {},
  start: () => {},
  stop: () => {},
} as IBroker;

const ROUND_TRIP_ID = '00000000-0000-4000-8000-0000000000a1';
const DEPLOYMENT_ID = '00000000-0000-4000-8000-0000000000b2';

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

function wirePm(store: IStore, getInstrument: () => Instrument): void {
  PositionManager.resetForTests();
  PositionManager.configure({
    broker: stubBroker,
    store,
    feeRate: 0.001,
    logger: noopLogger,
    getInstrument,
    reconcileIntervalMs: 0,
  });
  PositionManager.getInstance().setCapitalAllocation(spec.symbol, 10_000, 10_000);
}

afterEach(() => {
  PositionManager.resetForTests();
});

describe('TestBroker', () => {
  it('placeOrder applies entry and updates position', async () => {
    const store = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));
    const inst = new Instrument(spec, []);
    inst.addCandle({
      dateUnix: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    wirePm(store, () => inst);

    const broker = new TestBroker({
      logger: noopLogger,
      store,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => inst,
      getPositionBook: () => PositionManager.getInstance(),
    });

    await broker.placeOrder({
      instrument: inst,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
      roundTripId: ROUND_TRIP_ID,
      deploymentId: DEPLOYMENT_ID,
    });

    const snap = PositionManager.getInstance().getSnapshot(spec.symbol);
    expect(snap.currentPositionQty).toBeCloseTo(0.5, 5);
    expect(snap.avgEntryPrice).toBeCloseTo(100, 5);
  });

  it('closePosition flattens position', async () => {
    const store = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));
    const inst = new Instrument(spec, []);
    inst.addCandle({
      dateUnix: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    wirePm(store, () => inst);

    const broker = new TestBroker({
      logger: noopLogger,
      store,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => inst,
      getPositionBook: () => PositionManager.getInstance(),
    });

    await broker.placeOrder({
      instrument: inst,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
      roundTripId: ROUND_TRIP_ID,
      deploymentId: DEPLOYMENT_ID,
    });
    expect(
      PositionManager.getInstance().getSnapshot(spec.symbol).currentPositionQty,
    ).toBeGreaterThan(0);

    await broker.closePosition('SOLUSDT', ROUND_TRIP_ID);
    expect(
      Math.abs(PositionManager.getInstance().getSnapshot(spec.symbol).currentPositionQty),
    ).toBeLessThan(1e-9);
  });

  it('closePosition uses strategy price when provided (not last bar close)', async () => {
    const storeA = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));
    const storeB = new BacktestStore(mkdtempSync(join(tmpdir(), 'ql-bt-')));

    const mkInstrument = () => {
      const i = new Instrument(spec, []);
      i.addCandle({
        dateUnix: 1,
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1,
      });
      i.addCandle({
        dateUnix: 2,
        open: 100,
        high: 200,
        low: 95,
        close: 180,
        volume: 1,
      });
      return i;
    };

    const instExplicit = mkInstrument();
    wirePm(storeA, () => instExplicit);
    const brokerExplicit = new TestBroker({
      logger: noopLogger,
      store: storeA,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => instExplicit,
      getPositionBook: () => PositionManager.getInstance(),
    });
    await brokerExplicit.placeOrder({
      instrument: instExplicit,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
      roundTripId: ROUND_TRIP_ID,
      deploymentId: DEPLOYMENT_ID,
    });
    await brokerExplicit.closePosition('SOLUSDT', ROUND_TRIP_ID, undefined, 96);
    const capExplicit = PositionManager.getInstance().getSnapshot(spec.symbol).availableCapital;

    const instBarClose = mkInstrument();
    PositionManager.resetForTests();
    wirePm(storeB, () => instBarClose);
    const brokerBarClose = new TestBroker({
      logger: noopLogger,
      store: storeB,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => instBarClose,
      getPositionBook: () => PositionManager.getInstance(),
    });
    await brokerBarClose.placeOrder({
      instrument: instBarClose,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
      roundTripId: ROUND_TRIP_ID,
      deploymentId: DEPLOYMENT_ID,
    });
    await brokerBarClose.closePosition('SOLUSDT', ROUND_TRIP_ID);
    const capBarClose = PositionManager.getInstance().getSnapshot(spec.symbol).availableCapital;

    expect(capExplicit).not.toBe(capBarClose);
  });

  it('FileStore order_history keeps one row id for entry then close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ql-oh-'));
    const store = new FileStore(dir, 'paper');
    const inst = new Instrument(spec, []);
    inst.addCandle({
      dateUnix: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    wirePm(store, () => inst);

    const broker = new TestBroker({
      logger: noopLogger,
      store,
      category: 'linear',
      feeRate: 0.001,
      getInstrument: () => inst,
      getPositionBook: () => PositionManager.getInstance(),
    });

    const rt = 'rt-single-id';
    await broker.placeOrder({
      instrument: inst,
      side: 'Buy',
      qty: 0.5,
      price: undefined,
      roundTripId: rt,
      deploymentId: DEPLOYMENT_ID,
    });
    await broker.closePosition(spec.symbol, rt);

    const raw = readFileSync(join(dir, 'paper', 'order_history.json'), 'utf8');
    const map = JSON.parse(raw) as Record<string, { status?: string }>;
    expect(Object.keys(map)).toEqual([rt]);
    expect(map[rt]?.status).toBe('closed');
  });
});
