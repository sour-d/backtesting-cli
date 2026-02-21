import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger, LogLevel } from '../ConsoleLogger.js';

describe('ConsoleLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should log info messages to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new ConsoleLogger();

    logger.info('test message');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain('INFO');
    expect(spy.mock.calls[0]![0]).toContain('test message');
  });

  it('should log error messages to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new ConsoleLogger();

    logger.error('something broke');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain('ERROR');
    expect(spy.mock.calls[0]![0]).toContain('something broke');
  });

  it('should log warn messages to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new ConsoleLogger();

    logger.warn('watch out');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain('WARN');
  });

  it('should suppress messages below minimum level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new ConsoleLogger({}, LogLevel.WARN);

    logger.debug('hidden');
    logger.info('also hidden');
    logger.warn('visible');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('should include context in log output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new ConsoleLogger({ component: 'Bot', symbol: 'BTCUSDT' });

    logger.info('processing');

    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('component=Bot');
    expect(output).toContain('symbol=BTCUSDT');
  });

  it('should include data as JSON when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new ConsoleLogger();

    logger.info('trade placed', { price: 100, quantity: 5 });

    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('"price":100');
    expect(output).toContain('"quantity":5');
  });

  it('should create child loggers with merged context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parent = new ConsoleLogger({ component: 'Bot' });
    const child = parent.child({ symbol: 'SOLUSDT' });

    child.info('evaluating');

    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('component=Bot');
    expect(output).toContain('symbol=SOLUSDT');
  });

  it('child logger inherits minimum level from parent', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parent = new ConsoleLogger({}, LogLevel.ERROR);
    const child = parent.child({ symbol: 'SOLUSDT' });

    child.info('should be hidden');

    expect(logSpy).not.toHaveBeenCalled();
  });
});
