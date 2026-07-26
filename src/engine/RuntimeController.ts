import type { Bot } from '../bot/Bot.js';
import type { IBroker } from '../broker/IBroker.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IMarketRuntime } from '../market-runtime/IMarketRuntime.js';
import type { PositionService } from '../position/PositionService.js';
import type { EventBus } from './events/EventBus.js';
import type { ReconciliationService } from './ReconciliationService.js';
import { wireEngineEvents } from './wireEngineEvents.js';

export interface RuntimeControllerDeps {
  readonly marketRuntime: IMarketRuntime;
  readonly broker: IBroker;
  readonly bot: Bot;
  readonly bus: EventBus;
  readonly positionService: PositionService;
  readonly reconciliationService: ReconciliationService;
  readonly logger: ILogger;
  /** Live venue/registry reconcile interval; `0` skips periodic `ReconcileTick` publish. */
  readonly reconcileIntervalMs: number;
}

/**
 * Owns live runtime lifecycle: market feed, broker worker, deployments restore, and position venue sync teardown.
 */
export class RuntimeController {
  readonly marketRuntime: IMarketRuntime;
  readonly broker: IBroker;
  readonly bot: Bot;
  readonly bus: EventBus;
  readonly positionService: PositionService;
  readonly reconciliationService: ReconciliationService;
  private readonly logger: ILogger;
  private readonly reconcileIntervalMs: number;
  private stopReconcilePublisher?: () => void;

  constructor(deps: RuntimeControllerDeps) {
    this.marketRuntime = deps.marketRuntime;
    this.broker = deps.broker;
    this.bot = deps.bot;
    this.bus = deps.bus;
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
   * Restore persistence first (no live WS yet), wire event bus, connect market feed, then broker.
   */
  async start(): Promise<void> {
    await this.restore();
    const { stopReconcilePublisher } = wireEngineEvents({
      bus: this.bus,
      bot: this.bot,
      reconciliationService: this.reconciliationService,
      broker: this.broker,
      reconcileIntervalMs: this.reconcileIntervalMs,
      logger: this.logger,
    });
    this.stopReconcilePublisher = stopReconcilePublisher;
    this.marketRuntime.onCandle((instrument) => {
      void this.bus.publish({ type: 'CandleClosed', instrument });
    });
    await this.marketRuntime.start();
    this.broker.start();
  }

  /**
   * Stop reconcile publisher, broker hooks, and market runtime.
   */
  async stop(): Promise<void> {
    this.stopReconcilePublisher?.();
    this.stopReconcilePublisher = undefined;
    this.broker.stop();
    await this.marketRuntime.stop();
    this.logger.info('Engine shutdown complete');
  }
}
