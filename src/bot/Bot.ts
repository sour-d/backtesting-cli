import type { DeploymentState } from "../deployment/types.js";
import { Instrument } from "../instrument/Instrument.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IMarketRuntime } from "../market-runtime/IMarketRuntime.js";
import type { IBroker } from "../broker/IBroker.js";
import type { IStore } from "../store/IStore.js";
import type { IStrategy } from "../strategy/IStrategy.js";
import type { StrategyRegistry } from "../strategy/StrategyRegistry.js";
import type { ITradingContextProvider } from "./ITradingContextProvider.js";
import { PositionService } from "../position/PositionService.js";
import { parseKlineInterval } from "../config/klineInterval.js";
import { resolveBrokerFeeRate } from "../broker/resolveBrokerFeeRate.js";
import { ReconciliationService } from "../engine/ReconciliationService.js";
import { TradeEngine } from "../trade/TradeEngine.js";
import { PerSymbolMutex } from "../util/perSymbolMutex.js";

function applyIndicatorRegistrations(
  instrument: Instrument,
  strategy: IStrategy,
): void {
  const list = strategy.getIndicators?.() ?? [];
  for (const { name, compute } of list) {
    instrument.registerIndicator(name, { name, compute });
  }
}

export interface DeployRequest {
  readonly id: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly capital: number;
  /** Bybit interval code (e.g. "60", "240", "D"). Defaults to engine default (live: CLI / `KLINE_INTERVAL`). */
  readonly klineInterval?: string;
}

export interface BotDeps {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly broker: IBroker;
  readonly marketRuntime: IMarketRuntime;
  readonly strategies: StrategyRegistry;
  readonly positionService: PositionService;
  /** When set (e.g. backtest), used for `TradeRecord.fee` in {@link TradeEngine}. */
  readonly feeRate?: number;
  /** Raw interval string (e.g. from `KLINE_INTERVAL` / `--interval` / quantlab config). */
  readonly defaultKlineInterval: string;
  /** Positive: pause signals after this many consecutive broker throws (see {@link TradeEngine}). */
  readonly brokerFailureThreshold?: number;
  /** Ms to pause after threshold (default 60_000). */
  readonly brokerPauseCooldownMs?: number;
}

/**
 * Strategy runtime + deployment persistence. Does not own market ingress — only reacts to candles.
 */
export class Bot implements ITradingContextProvider {
  readonly tradeEngine: TradeEngine;
  readonly reconciliationService: ReconciliationService;
  /** Shared with {@link TradeEngine} and {@link ReconciliationService} for per-symbol serialization. */
  readonly symbolMutex = new PerSymbolMutex();
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly broker: IBroker;
  private readonly marketRuntime: IMarketRuntime;
  private readonly registry: StrategyRegistry;
  private readonly feeRate: number;
  private readonly defaultKlineInterval: string;
  private readonly positionService: PositionService;
  /** In-memory routing: strategy + deployment + kline interval per symbol (persisted deployments are source of truth). */
  private readonly activeDeployments = new Map<
    string,
    {
      readonly strategyId: string;
      readonly deploymentId: string;
      /** Raw Bybit-style interval (e.g. `"5"`, `"60"`) for trade JSONL + {@link PositionService}. */
      readonly klineInterval: string;
    }
  >();

  constructor(deps: BotDeps) {
    this.logger = deps.logger;
    this.store = deps.store;
    this.broker = deps.broker;
    this.marketRuntime = deps.marketRuntime;
    this.registry = deps.strategies;
    this.feeRate = deps.feeRate ?? 0;
    this.defaultKlineInterval = deps.defaultKlineInterval;
    this.positionService = deps.positionService;
    const getInstrument = (symbol: string) => deps.marketRuntime.getInstrument(symbol);

    this.reconciliationService = new ReconciliationService({
      broker: deps.broker,
      positionService: deps.positionService,
      store: deps.store,
      logger: deps.logger,
      defaultFeeRate: this.feeRate,
      getInstrument,
      tradingContext: this,
      symbolMutex: this.symbolMutex,
    });
    this.tradeEngine = new TradeEngine({
      broker: deps.broker,
      positionService: deps.positionService,
      store: deps.store,
      logger: deps.logger,
      defaultFeeRate: this.feeRate,
      brokerFailureThreshold: deps.brokerFailureThreshold,
      brokerPauseCooldownMs: deps.brokerPauseCooldownMs,
      symbolMutex: this.symbolMutex,
    });
  }

  getActiveSymbols(): Array<{
    symbol: string;
    deploymentId: string;
    klineInterval: string;
  }> {
    return Array.from(this.activeDeployments.entries()).map(([symbol, v]) => ({
      symbol,
      deploymentId: v.deploymentId,
      klineInterval: v.klineInterval,
    }));
  }

  async deploy(req: DeployRequest): Promise<{ readonly klineInterval: string }> {
    const strategy = this.registry.resolve(req.strategyId);
    if (!strategy) {
      throw new Error(`Unknown strategyId: ${req.strategyId}`);
    }

    const intervalRaw = (req.klineInterval ?? this.defaultKlineInterval).trim();
    const klineInterval = parseKlineInterval(intervalRaw);

    const spec = await this.marketRuntime.fetchInstrumentStatic(req.symbol);
    const instrument = new Instrument(spec, strategy.getIndicators() ?? []);
    this.positionService.setCapitalAllocation(
      req.symbol,
      req.capital,
      req.capital,
    );
    await this.marketRuntime.registerInstrument(instrument, { klineInterval });

    this.activeDeployments.set(req.symbol, {
      strategyId: req.strategyId,
      deploymentId: req.id,
      klineInterval: intervalRaw,
    });

    const state: DeploymentState = {
      id: req.id,
      symbol: req.symbol,
      strategyId: req.strategyId,
      capital: req.capital,
      klineInterval: intervalRaw,
      createdAt: Date.now(),
      status: "active",
    };
    await this.store.saveDeployment(state);
    this.logger.info("Deployed", {
      id: req.id,
      symbol: req.symbol,
      strategyId: req.strategyId,
      klineInterval: intervalRaw,
    });
    return { klineInterval: intervalRaw };
  }

  /**
   * Unsubscribe WS feed, drop in-memory routing, remove deployment row from the store.
   */
  async removeDeployment(id: string): Promise<void> {
    const rows = await this.store.loadDeployments();
    const d = rows.find((r) => r.id === id);
    if (!d) {
      throw new Error(`Deployment not found: ${id}`);
    }

    const pm = this.positionService;
    const openQty = Math.abs(pm.getSnapshot(d.symbol).currentPositionQty);
    if (openQty >= 1e-12) {
      throw new Error(
        `Cannot remove deployment ${id} (${d.symbol}): position is open (qty ${openQty}). Close the position first.`,
      );
    }

    pm.purgeSymbol(d.symbol);
    await this.marketRuntime.unregisterInstrument(d.symbol);
    this.activeDeployments.delete(d.symbol);
    await this.store.deleteDeployment(id);
    this.logger.info("Deployment removed", { id, symbol: d.symbol });
  }

  async restoreDeployments(): Promise<void> {
    const rows = await this.store.loadDeployments();
    const live = rows.filter((r) => r.status === "active");
    this.logger.info("Restoring deployments", { count: live.length });
    const pm = this.positionService;
    for (const d of live) {
      const strategy = this.registry.resolve(d.strategyId);
      if (!strategy) {
        this.logger.error("Skipping deployment — unknown strategy", {
          id: d.id,
          strategyId: d.strategyId,
        });
        continue;
      }
      const intervalRaw = (d.klineInterval ?? this.defaultKlineInterval).trim();
      const klineInterval = parseKlineInterval(intervalRaw);

      const spec = await this.marketRuntime.fetchInstrumentStatic(d.symbol);
      const instrument = new Instrument(spec, strategy.getIndicators());
      pm.setCapitalAllocation(d.symbol, d.capital, d.capital);
      applyIndicatorRegistrations(instrument, strategy);
      await this.marketRuntime.registerInstrument(instrument, { klineInterval });

      this.activeDeployments.set(d.symbol, {
        strategyId: d.strategyId,
        deploymentId: d.id,
        klineInterval: intervalRaw,
      });

      const row = await this.store.loadPositionByDeploymentId(d.id);
      const openPosition = row
        ? {
            positionId: row.id,
            side: row.side,
            qty: row.qty,
            avgEntryPrice: row.avgEntryPrice ?? null,
          }
        : null;
      if (row) {
        pm.registerOpenPosition(d.symbol, row.id, d.id, intervalRaw);
        pm.hydrateFromStoredRow(d.symbol, row);
      }

      await this.reconciliationService.syncAfterRestore(
        instrument,
        d.id,
        intervalRaw,
      );

      this.logger.info("Restored deployment", {
        deploymentId: d.id,
        symbol: d.symbol,
        strategyId: d.strategyId,
        klineInterval: intervalRaw,
        capital: d.capital,
        openPosition,
      });
    }
  }

  async onCandle(instrument: Instrument): Promise<void> {
    const dep = this.activeDeployments.get(instrument.symbol);
    if (!dep) {
      this.logger.debug("onCandle: skip — no active deployment", {
        symbol: instrument.symbol,
      });
      return;
    }

    const strategy = this.registry.resolve(dep.strategyId);
    if (!strategy) {
      this.logger.warn("onCandle: skip — unknown strategy", {
        symbol: instrument.symbol,
        strategyId: dep.strategyId,
      });
      return;
    }

    await this.symbolMutex.runExclusive(instrument.symbol, async () => {
      const pm = this.positionService;
      const fr = await resolveBrokerFeeRate(
        this.broker,
        instrument.symbol,
        this.feeRate,
      );
      pm.setSymbolFeeRate(instrument.symbol, fr);
      const sync = this.broker.syncPositionFromVenue;
      if (typeof sync === "function") {
        try {
          await sync.call(this.broker, instrument.symbol);
        } catch (e) {
          this.logger.warn("DEBUG:: syncPositionFromVenue (onCandle) failed", {
            symbol: instrument.symbol,
            message: String(e),
          });
        }
      }
      await this.reconciliationService.reconcileMissingRowIfNeeded(
        instrument,
        dep.deploymentId,
        dep.klineInterval,
      );
      const position = pm.getSnapshot(instrument.symbol);
      const raw = await strategy.evaluate(instrument, position);
      const signals = Array.isArray(raw) ? raw : [raw];
      for (const signal of signals) {
        const candle = instrument.getCandles(1)[0]!;
        await this.tradeEngine.executeDirect(signal, instrument, {
          deploymentId: dep.deploymentId,
          klineInterval: dep.klineInterval,
          candle,
        });
      }
    });
  }
}
