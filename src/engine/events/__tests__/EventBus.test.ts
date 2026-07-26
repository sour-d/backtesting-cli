import { describe, expect, it, vi } from 'vitest';
import type { ILogger } from '../../../logger/ILogger.js';
import type { Instrument } from '../../../instrument/Instrument.js';
import { EventBus } from '../EventBus.js';

function mockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => mockLogger(),
  };
}

describe('EventBus', () => {
  it('invokes listeners in registration order', async () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    const order: number[] = [];
    bus.on('ReconcileTick', async () => {
      order.push(1);
    });
    bus.on('ReconcileTick', async () => {
      order.push(2);
    });
    await bus.publish({ type: 'ReconcileTick' });
    expect(order).toEqual([1, 2]);
  });

  it('await async listeners sequentially', async () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    const order: string[] = [];
    bus.on('ReconcileTick', async () => {
      order.push('a-start');
      await Promise.resolve();
      order.push('a-end');
    });
    bus.on('ReconcileTick', async () => {
      order.push('b');
    });
    await bus.publish({ type: 'ReconcileTick' });
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  it('logs and continues when a listener throws', async () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    let secondRan = false;
    bus.on('ReconcileTick', async () => {
      throw new Error('boom');
    });
    bus.on('ReconcileTick', async () => {
      secondRan = true;
    });
    await bus.publish({ type: 'ReconcileTick' });
    expect(secondRan).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'DEBUG:: EventBus listener failed',
      expect.objectContaining({ type: 'ReconcileTick', message: expect.stringContaining('boom') }),
    );
  });

  it('dispatches CandleClosed only to matching listeners', async () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    const inst = {} as Instrument;
    let tickHits = 0;
    let candleHits = 0;
    bus.on('ReconcileTick', async () => {
      tickHits += 1;
    });
    bus.on('CandleClosed', async () => {
      candleHits += 1;
    });
    await bus.publish({ type: 'CandleClosed', instrument: inst });
    expect(tickHits).toBe(0);
    expect(candleHits).toBe(1);
  });
});
