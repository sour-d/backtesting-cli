import crypto from 'node:crypto';
import type { Position } from '../types/index.js';
import type { Deployment, DeploymentConfig, DeploymentInfo, DeployRequest, StoredTrade } from '../types/deployment.js';
import type { IStore } from '../store/IStore.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IBroker } from '../broker/IBroker.js';
import type { Bot } from '../trading-bot/Bot.js';
import type { Market } from '../market/Market.js';
import type { LiveFeed } from '../datasource/feeds/LiveFeed.js';
import { resolveStrategy, getStrategyDefinitions } from '../strategy/index.js';

export interface DeploymentManagerDeps {
  bot: Bot;
  broker: IBroker;
  market: Market;
  store: IStore;
  logger: ILogger;
  liveFeed?: LiveFeed;
}

export class DeploymentManager {
  private readonly deployments: Map<string, Deployment> = new Map();
  private readonly deploymentsBySymbol: Map<string, string> = new Map();
  private readonly bot: Bot;
  private readonly broker: IBroker;
  private readonly market: Market;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly liveFeed: LiveFeed | null;

  constructor(deps: DeploymentManagerDeps) {
    this.bot = deps.bot;
    this.broker = deps.broker;
    this.market = deps.market;
    this.store = deps.store;
    this.logger = deps.logger;
    this.liveFeed = deps.liveFeed ?? null;
  }

  async deploy(request: DeployRequest): Promise<Deployment[]> {
    const strategyDefs = getStrategyDefinitions();
    if (!strategyDefs[request.strategy]) {
      throw new Error(`Unknown strategy: ${request.strategy}`);
    }

    for (const symbol of request.symbols) {
      if (this.deploymentsBySymbol.has(symbol)) {
        throw new Error(`Symbol ${symbol} already has an active deployment`);
      }
    }

    const perSymbolCapital = request.capital / request.symbols.length;
    const config: DeploymentConfig = {
      capital: perSymbolCapital,
      riskPercentage: request.riskPercentage,
      maxAllocation: request.maxAllocation,
      feeRate: request.feeRate ?? 0.001,
    };

    const created: Deployment[] = [];

    for (const symbol of request.symbols) {
      const deployment: Deployment = {
        id: crypto.randomUUID(),
        symbol,
        strategyName: request.strategy,
        config,
        strategyParams: request.strategyParams ?? {},
        status: 'active',
        currentCapital: perSymbolCapital,
        createdAt: Date.now(),
      };

      const strategy = resolveStrategy(request.strategy, request.strategyParams);

      this.broker.allocateCapitalForSymbol(symbol, perSymbolCapital);
      if ('setSymbolConfig' in this.broker) {
        (this.broker as { setSymbolConfig(s: string, c: { riskPercentage: number; maxAllocation: number }): void })
          .setSymbolConfig(symbol, { riskPercentage: config.riskPercentage, maxAllocation: config.maxAllocation });
      }

      this.bot.addSymbol(symbol, strategy);
      this.liveFeed?.addSymbol(symbol);
      this.deployments.set(deployment.id, deployment);
      this.deploymentsBySymbol.set(symbol, deployment.id);

      await this.store.saveDeployment(deployment);

      this.logger.info('Deployment created', { id: deployment.id, symbol, strategy: request.strategy });
      created.push(deployment);
    }

    return created;
  }

  async stop(deploymentId: string): Promise<number> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const position = this.broker.getPosition(deployment.symbol);
    if (position) {
      const lastCandle = this.market.getStock(deployment.symbol).now();
      this.broker.exitPosition(deployment.symbol, lastCandle.close, lastCandle.dateUnix);
      await this.store.removePosition(deploymentId);
    }

    const result = this.broker.deallocateCapitalForSymbol(deployment.symbol);
    const returnedCapital = result.ok ? result.value : 0;

    this.bot.removeSymbol(deployment.symbol);
    this.liveFeed?.removeSymbol(deployment.symbol);
    deployment.status = 'stopped';
    deployment.currentCapital = returnedCapital;

    this.deploymentsBySymbol.delete(deployment.symbol);

    await this.store.updateDeployment(deploymentId, { status: 'stopped', currentCapital: returnedCapital });
    this.deployments.delete(deploymentId);

    this.logger.info('Deployment stopped', { id: deploymentId, symbol: deployment.symbol, returnedCapital });
    return returnedCapital;
  }

  async pause(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);
    if (deployment.status !== 'active') throw new Error(`Deployment ${deploymentId} is not active`);

    deployment.status = 'paused';
    this.bot.pauseSymbol(deployment.symbol);
    await this.store.updateDeployment(deploymentId, { status: 'paused' });

    this.logger.info('Deployment paused', { id: deploymentId, symbol: deployment.symbol });
  }

  async resume(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);
    if (deployment.status !== 'paused') throw new Error(`Deployment ${deploymentId} is not paused`);

    deployment.status = 'active';
    this.bot.resumeSymbol(deployment.symbol);
    await this.store.updateDeployment(deploymentId, { status: 'active' });

    this.logger.info('Deployment resumed', { id: deploymentId, symbol: deployment.symbol });
  }

  async update(deploymentId: string, patch: Partial<DeploymentConfig>): Promise<Deployment> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const updatedConfig = { ...deployment.config, ...patch };
    (deployment as { config: DeploymentConfig }).config = updatedConfig;

    if ('setSymbolConfig' in this.broker) {
      (this.broker as { setSymbolConfig(s: string, c: { riskPercentage: number; maxAllocation: number }): void })
        .setSymbolConfig(deployment.symbol, {
          riskPercentage: updatedConfig.riskPercentage,
          maxAllocation: updatedConfig.maxAllocation,
        });
    }

    await this.store.updateDeployment(deploymentId, { config: updatedConfig } as Partial<Deployment>);
    this.logger.info('Deployment updated', { id: deploymentId, symbol: deployment.symbol });

    return deployment;
  }

  list(): DeploymentInfo[] {
    const result: DeploymentInfo[] = [];
    for (const deployment of this.deployments.values()) {
      result.push(this.enrichDeployment(deployment));
    }
    return result;
  }

  get(deploymentId: string): DeploymentInfo | null {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return null;
    return this.enrichDeployment(deployment);
  }

  getBySymbol(symbol: string): DeploymentInfo | null {
    const id = this.deploymentsBySymbol.get(symbol);
    if (!id) return null;
    return this.get(id);
  }

  async syncPositionToDB(deploymentId: string, position: Position): Promise<void> {
    await this.store.savePosition(deploymentId, position);
  }

  async removePositionFromDB(deploymentId: string): Promise<void> {
    await this.store.removePosition(deploymentId);
  }

  async recordCompletedTrade(trade: StoredTrade): Promise<void> {
    await this.store.saveTrade(trade);
    const deployment = this.deployments.get(trade.deploymentId);
    if (deployment) {
      deployment.currentCapital = this.broker.getCapital(deployment.symbol);
      await this.store.updateDeployment(trade.deploymentId, { currentCapital: deployment.currentCapital });
    }
  }

  async restoreFromStore(): Promise<number> {
    const saved = await this.store.loadActiveDeployments();
    let restored = 0;

    for (const deployment of saved) {
      try {
        const strategy = resolveStrategy(deployment.strategyName, deployment.strategyParams);

        this.broker.allocateCapitalForSymbol(deployment.symbol, deployment.currentCapital);
        if ('setSymbolConfig' in this.broker) {
          (this.broker as { setSymbolConfig(s: string, c: { riskPercentage: number; maxAllocation: number }): void })
            .setSymbolConfig(deployment.symbol, {
              riskPercentage: deployment.config.riskPercentage,
              maxAllocation: deployment.config.maxAllocation,
            });
        }

        const position = await this.store.loadPosition(deployment.id);
        if (position) {
          this.broker.restorePosition(deployment.symbol, position);
        }

        this.bot.addSymbol(deployment.symbol, strategy);
        this.liveFeed?.addSymbol(deployment.symbol);
        if (deployment.status === 'paused') {
          this.bot.pauseSymbol(deployment.symbol);
        }

        this.deployments.set(deployment.id, deployment);
        this.deploymentsBySymbol.set(deployment.symbol, deployment.id);
        restored++;

        this.logger.info('Deployment restored', {
          id: deployment.id,
          symbol: deployment.symbol,
          strategy: deployment.strategyName,
          hasPosition: String(!!position),
        });
      } catch (err) {
        this.logger.error('Failed to restore deployment', {
          id: deployment.id,
          symbol: deployment.symbol,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return restored;
  }

  private enrichDeployment(deployment: Deployment): DeploymentInfo {
    const position = this.broker.getPosition(deployment.symbol);
    const currentCapital = this.broker.getCapital(deployment.symbol);
    const trades = this.store.getTrades().filter((t) => t.symbol === deployment.symbol);
    const exitCount = trades.filter((t) => t.type === 'EXIT' || t.type === 'STOP_LOSS').length;

    let unrealizedPnl = 0;
    if (position) {
      const stock = this.market.getStock(deployment.symbol);
      const currentPrice = stock.now().close;
      if (position.side === 'Buy') {
        unrealizedPnl = position.quantity * (currentPrice - position.entryPrice);
      } else {
        unrealizedPnl = position.quantity * (position.entryPrice - currentPrice);
      }
    }

    const realizedPnl = currentCapital - deployment.config.capital +
      (position ? position.quantity * position.entryPrice : 0);

    return {
      ...deployment,
      currentCapital,
      position,
      tradeCount: exitCount,
      pnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    };
  }
}
