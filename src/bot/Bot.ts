import { randomUUID } from "node:crypto";
import type { EnrichedCandle } from "../core/types.js";
import type { TradeRecord } from "../core/types.js";
import type { DeploymentState } from "../deployment/types.js";
import { Instrument } from "../instrument/Instrument.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IMarketRuntime } from "../market-runtime/IMarketRuntime.js";
import type { IBroker } from "../broker/IBroker.js";
import type { IStore } from "../store/IStore.js";
import type { IStrategy } from "../strategy/IStrategy.js";
import type { StrategyRegistry } from "../strategy/StrategyRegistry.js";
import type { StrategyEvaluateResult } from "../strategy/types.js";
import { parseKlineInterval } from "../config/klineInterval.js";

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
  /** When set (e.g. backtest), used for `TradeRecord.fee` in `persistTrade`. */
  readonly feeRate?: number;
  /** Raw interval string (e.g. from `KLINE_INTERVAL` / `--interval` / quantlab config). */
  readonly defaultKlineInterval: string;
}

/**
 * Strategy runtime + deployment persistence. Does not own market ingress — only reacts to candles.
 */
export class Bot {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly broker: IBroker;
  private readonly marketRuntime: IMarketRuntime;
  private readonly registry: StrategyRegistry;
  private readonly feeRate: number;
  private readonly defaultKlineInterval: string;
  /** In-memory routing: which strategy id applies to each deployed symbol (persisted deployments are source of truth). */
  private readonly activeDeployments = new Map<
    string,
    { readonly strategyId: string }
  >();

  constructor(deps: BotDeps) {
    this.logger = deps.logger;
    this.store = deps.store;
    this.broker = deps.broker;
    this.marketRuntime = deps.marketRuntime;
    this.registry = deps.strategies;
    this.feeRate = deps.feeRate ?? 0;
    this.defaultKlineInterval = deps.defaultKlineInterval;
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
    instrument.setCapitalAllocation(req.capital, req.capital);
    await this.marketRuntime.registerInstrument(instrument, { klineInterval });

    this.activeDeployments.set(req.symbol, { strategyId: req.strategyId });

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

    await this.marketRuntime.unregisterInstrument(d.symbol);
    this.activeDeployments.delete(d.symbol);
    await this.store.deleteDeployment(id);
    this.logger.info("Deployment removed", { id, symbol: d.symbol });
  }

  async restoreDeployments(): Promise<void> {
    const rows = await this.store.loadDeployments();
    const live = rows.filter((r) => r.status === "active");
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
      instrument.setCapitalAllocation(d.capital, d.capital);
      applyIndicatorRegistrations(instrument, strategy);
      await this.marketRuntime.registerInstrument(instrument, { klineInterval });

      this.activeDeployments.set(d.symbol, { strategyId: d.strategyId });
      this.logger.info("Restored deployment", { id: d.id, symbol: d.symbol });
    }
  }

  async onCandle(instrument: Instrument): Promise<void> {
    const dep = this.activeDeployments.get(instrument.symbol);
    if (!dep) return;

    const strategy = this.registry.resolve(dep.strategyId);
    if (!strategy) return;

    const raw = await strategy.evaluate(instrument);
    const signals = Array.isArray(raw) ? raw : [raw];
    for (const signal of signals) {
      const candle = instrument.getCandles(1)[0]!;
      await this.dispatch(instrument, candle, signal);
    }
  }

  private async dispatch(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: StrategyEvaluateResult,
  ): Promise<void> {
    if (signal.action === "HOLD") {
      return;
    }

    if (signal.action === "CLOSE") {
      const exitSide = instrument.getCloseOrderSide();
      if (!exitSide) {
        this.logger.debug("CLOSE ignored — flat position", {
          symbol: instrument.symbol,
        });
        return;
      }
      const posAbs = Math.abs(instrument.currentPositionQty);
      const closeAll = signal.qty === undefined;
      const exitQty = closeAll
        ? posAbs
        : Math.min(instrument.roundQty(Math.abs(signal.qty!)), posAbs);
      if (exitQty <= 0) {
        this.logger.debug("CLOSE ignored — zero qty", {
          symbol: instrument.symbol,
        });
        return;
      }
      const strategyExitPrice =
        signal.price !== undefined &&
        Number.isFinite(signal.price) &&
        signal.price > 0
          ? signal.price
          : undefined;
      await this.broker.closePosition(
        instrument.symbol,
        closeAll ? undefined : exitQty,
        strategyExitPrice,
      );
      const exitFillPrice = strategyExitPrice ?? candle.close;
      await this.persistTrade({
        instrument,
        candle,
        kind: "exit",
        qty: exitQty,
        price: exitFillPrice,
        side: exitSide,
      });
      this.logger.info("Signal CLOSE executed", {
        symbol: instrument.symbol,
        exitRefPrice: exitFillPrice,
        strategyPrice: signal.price,
        closeAll,
        qty: exitQty,
      });
      return;
    }

    const side = signal.action === "BUY" ? "Buy" : "Sell";
    await this.broker.placeOrder({
      instrument,
      side,
      qty: signal.qty,
      price: signal.price,
    });

    await this.persistTrade({
      instrument,
      candle,
      kind: "entry",
      qty: signal.qty,
      price: signal.price,
      side,
    });
    this.logger.info("Signal executed", {
      symbol: instrument.symbol,
      action: signal.action,
      qty: signal.qty,
      price: signal.price,
      stopLoss: signal.stopLoss,
    });
  }

  private async persistTrade(params: {
    instrument: Instrument;
    candle: EnrichedCandle;
    kind: TradeRecord["kind"];
    qty: number;
    price: number;
    side: "Buy" | "Sell";
  }): Promise<void> {
    const notional = params.qty * params.price;
    const rec: TradeRecord = {
      id: randomUUID(),
      symbol: params.instrument.symbol,
      side: params.side,
      qty: params.qty,
      price: params.price,
      fee: this.feeRate > 0 ? notional * this.feeRate : 0,
      timestamp: params.candle.dateUnix,
      kind: params.kind,
    };
    await this.store.saveTrade(rec);
  }
}
