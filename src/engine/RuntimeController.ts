import type { Bot } from '../bot/Bot.js';
import type { IBroker } from '../broker/IBroker.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IMarketRuntime } from '../market-runtime/IMarketRuntime.js';
import type { PositionService } from '../position/PositionService.js';
import type { ReconciliationService } from './ReconciliationService.js';

export interface RuntimeControllerDeps {
  readonly marketRuntime: IMarketRuntime;
  readonly broker: IBroker;
  readonly bot: Bot;
  readonly positionService: PositionService;
  readonly reconciliationService: ReconciliationService;
  readonly logger: ILogger;
  /** Live venue/registry reconcile interval; `0` skips {@link ReconciliationService#start}. */
  readonly reconcileIntervalMs: number;
}

/**
 * Owns live runtime lifecycle: market feed, broker worker, deployments restore, and position venue sync teardown.
 */
export class RuntimeController {
  readonly marketRuntime: IMarketRuntime;
  readonly broker: IBroker;
  readonly bot: Bot;
  readonly positionService: PositionService;
  readonly reconciliationService: ReconciliationService;
  private readonly logger: ILogger;
  private readonly reconcileIntervalMs: number;

  constructor(deps: RuntimeControllerDeps) {
    this.marketRuntime = deps.marketRuntime;
    this.broker = deps.broker;
    this.bot = deps.bot;
    this.positionService = deps.positionService;
    this.reconciliationService = deps.reconciliationService;
    this.logger = deps.logger;
    this.reconcileIntervalMs = deps.reconcileIntervalMs;
  }

  /** Reload deployments and bot state from persistence (idempotent with respect to a single run). */
  async restore(): Promise<void> {
    await this.bot.restoreDeployments();
  }

  /**
   * Restore persistence first (no live WS yet), wire candles, connect market feed, then broker/reconcile hooks.
   */
  async start(): Promise<void> {
    await this.restore();
    this.marketRuntime.onCandle((instrument) => this.bot.onCandle(instrument));
    await this.marketRuntime.start();
    if (this.reconcileIntervalMs > 0) {
      this.reconciliationService.start(this.reconcileIntervalMs);
    }
    this.broker.start();
  }

  /**
   * Stop reconciliation loop, broker hooks, and market runtime.
   */
  async stop(): Promise<void> {
    this.reconciliationService.stop();
    this.broker.stop();
    await this.marketRuntime.stop();
    this.logger.info('Engine shutdown complete');
  }
}
