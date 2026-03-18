import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentManager } from '../DeploymentManager.js';
import { Bot } from '../../trading-bot/Bot.js';
import { Market } from '../../market/Market.js';
import { SimulatedBroker } from '../../broker/SimulatedBroker.js';
import { FileStore } from '../../store/FileStore.js';
import type { ILogger } from '../../logger/ILogger.js';
import type { DeployRequest } from '../../types/deployment.js';

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createMockLogger(),
  };
}

describe('DeploymentManager', () => {
  let dm: DeploymentManager;
  let bot: Bot;
  let broker: SimulatedBroker;
  let market: Market;
  let store: FileStore;
  let logger: ILogger;

  beforeEach(() => {
    market = new Market([]);
    store = new FileStore('.data');
    broker = new SimulatedBroker({ feeRate: 0.001, riskPercentage: 5, maxAllocation: 0.8 });
    logger = createMockLogger();
    bot = new Bot({ market, broker, store, logger });
    dm = new DeploymentManager({ bot, broker, market, store, logger });
  });

  const baseRequest: DeployRequest = {
    symbols: ['SOLUSDT', 'BTCUSDT'],
    strategy: 'MovingAverage_v2',
    capital: 10000,
    riskPercentage: 5,
    maxAllocation: 0.8,
  };

  it('should create deployments for multiple symbols', async () => {
    const deployments = await dm.deploy(baseRequest);

    expect(deployments).toHaveLength(2);
    expect(deployments[0]!.symbol).toBe('SOLUSDT');
    expect(deployments[1]!.symbol).toBe('BTCUSDT');
    expect(deployments[0]!.config.capital).toBe(5000);
    expect(deployments[0]!.status).toBe('active');
  });

  it('should allocate capital equally among symbols', async () => {
    await dm.deploy(baseRequest);

    expect(broker.getCapital('SOLUSDT')).toBe(5000);
    expect(broker.getCapital('BTCUSDT')).toBe(5000);
  });

  it('should reject duplicate symbol deployment', async () => {
    await dm.deploy(baseRequest);

    await expect(dm.deploy({
      ...baseRequest,
      symbols: ['SOLUSDT'],
      capital: 5000,
    })).rejects.toThrow('already has an active deployment');
  });

  it('should reject unknown strategy', async () => {
    await expect(dm.deploy({
      ...baseRequest,
      strategy: 'NonExistentStrategy',
    })).rejects.toThrow('Unknown strategy');
  });

  it('should list deployments with enriched info', async () => {
    await dm.deploy(baseRequest);

    const list = await dm.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.position).toBeNull();
    expect(list[0]!.tradeCount).toBe(0);
    expect(list[0]!.pnl).toBe(0);
  });

  it('should get a single deployment by id', async () => {
    const [first] = await dm.deploy(baseRequest);

    const info = await dm.get(first!.id);
    expect(info).not.toBeNull();
    expect(info!.symbol).toBe('SOLUSDT');
  });

  it('should return null for unknown deployment id', async () => {
    expect(await dm.get('nonexistent')).toBeNull();
  });

  it('should pause and resume a deployment', async () => {
    const [first] = await dm.deploy(baseRequest);

    await dm.pause(first!.id);
    expect((await dm.get(first!.id))!.status).toBe('paused');

    await dm.resume(first!.id);
    expect((await dm.get(first!.id))!.status).toBe('active');
  });

  it('should stop a deployment and return capital', async () => {
    const [first] = await dm.deploy(baseRequest);

    const returned = await dm.stop(first!.id);
    expect(returned).toBe(5000);
    expect(await dm.get(first!.id)).toBeNull();
    expect(broker.getCapital('SOLUSDT')).toBe(0);
  });

  it('should update deployment config', async () => {
    const [first] = await dm.deploy(baseRequest);

    const updated = await dm.update(first!.id, { riskPercentage: 3 });
    expect(updated.config.riskPercentage).toBe(3);
    expect(updated.config.maxAllocation).toBe(0.8);
  });

  it('should allow deploying to a symbol after stopping its previous deployment', async () => {
    const [first] = await dm.deploy({ ...baseRequest, symbols: ['SOLUSDT'], capital: 5000 });
    await dm.stop(first!.id);

    const [second] = await dm.deploy({ ...baseRequest, symbols: ['SOLUSDT'], capital: 8000 });
    expect(second!.config.capital).toBe(8000);
  });

  it('should register symbols with the bot', async () => {
    await dm.deploy(baseRequest);

    expect(bot.isSymbolActive('SOLUSDT')).toBe(true);
    expect(bot.isSymbolActive('BTCUSDT')).toBe(true);
  });

  it('should pause symbol in bot when deployment is paused', async () => {
    const [first] = await dm.deploy(baseRequest);
    await dm.pause(first!.id);

    expect(bot.isSymbolActive('SOLUSDT')).toBe(false);
  });
});
