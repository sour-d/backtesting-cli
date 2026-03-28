import type { IPositionBook } from './IPositionBook.js';
import { PositionRuntime } from './PositionRuntime.js';
import type { PositionBookSnapshot, PositionRecord } from './types.js';
import { emptyPositionBookSnapshot } from './types.js';

export interface PositionServiceDeps {
  /** Default taker/maker rate when no per-symbol override is set (see {@link setSymbolFeeRate}). */
  readonly feeRate: number;
}

interface RegistryEntry {
  readonly positionRowId: string;
  readonly deploymentId: string;
  /** Raw kline interval from deployment (e.g. `1`, `240`, `D`) — trade file naming. */
  readonly klineInterval: string;
}

let singleton: PositionService | undefined;

/**
 * Singleton position book: runtime qty/capital per symbol + open-position registry (symbol → row id).
 * Execution and persistence live in `TradeEngine`.
 */
export class PositionService implements IPositionBook {
  private readonly defaultFeeRate: number;
  /** Per-symbol fee for venue snapshot recomputation (set from broker before sync). */
  private readonly symbolFeeOverrides = new Map<string, number>();
  private readonly bySymbol = new Map<string, RegistryEntry>();
  private readonly runtimes = new Map<string, PositionRuntime>();

  private constructor(deps: PositionServiceDeps) {
    this.defaultFeeRate = deps.feeRate;
  }

  /**
   * Overrides fee used when recomputing available capital after a venue snapshot for `symbol`.
   * Callers (e.g. {@link TradeEngine}) should set this from {@link IBroker.getFeeRate} when known.
   */
  setSymbolFeeRate(symbol: string, rate: number): void {
    if (Number.isFinite(rate) && rate >= 0) {
      this.symbolFeeOverrides.set(symbol, rate);
    }
  }

  private effectiveFeeRate(symbol: string): number {
    return this.symbolFeeOverrides.get(symbol) ?? this.defaultFeeRate;
  }

  static configure(deps: PositionServiceDeps): void {
    singleton = new PositionService(deps);
  }

  static getInstance(): PositionService {
    if (!singleton) {
      throw new Error('PositionService.configure() must be called before getInstance()');
    }
    return singleton;
  }

  /** Test isolation — clears singleton and registry. */
  static resetForTests(): void {
    singleton = undefined;
  }

  registerOpenPosition(
    symbol: string,
    positionRowId: string,
    deploymentId: string,
    klineInterval: string,
  ): void {
    this.bySymbol.set(symbol, { positionRowId, deploymentId, klineInterval });
  }

  /**
   * Clear persisted open-position registry + flat qty on runtime.
   * **Does not** remove runtime or capital — same as old `Instrument` staying alive after exit.
   */
  clearSymbol(symbol: string): void {
    this.bySymbol.delete(symbol);
    this.symbolFeeOverrides.delete(symbol);
    this.runtimes.get(symbol)?.clearOpenPositionKeepCapital();
  }

  /** Full drop (e.g. deployment removed) — registry + runtime including capital. */
  purgeSymbol(symbol: string): void {
    this.bySymbol.delete(symbol);
    this.symbolFeeOverrides.delete(symbol);
    this.runtimes.delete(symbol);
  }

  /** Symbols with an open position registry entry (used for venue reconcile union). */
  getRegisteredSymbols(): string[] {
    return [...this.bySymbol.keys()];
  }

  private runtimeFor(symbol: string): PositionRuntime {
    let r = this.runtimes.get(symbol);
    if (!r) {
      r = new PositionRuntime();
      this.runtimes.set(symbol, r);
    }
    return r;
  }

  applyEntry(
    symbol: string,
    side: 'Buy' | 'Sell',
    qty: number,
    price: number,
    fee: number,
  ): void {
    this.runtimeFor(symbol).applyEntry(side, qty, price, fee);
  }

  setPositionSnapshot(
    symbol: string,
    side: string,
    sizeAbs: number,
    avgEntry: number,
    unrealized: number,
  ): void {
    this.runtimeFor(symbol).setPositionSnapshot(side, sizeAbs, avgEntry, unrealized);
    this.recomputeAvailableFromAllocatedAndSnapshot(symbol);
  }

  /**
   * Live path: venue sync only updates qty/avg via {@link PositionRuntime.setPositionSnapshot} — unlike
   * backtest {@link PositionRuntime.applyEntry}. Recompute `availableCapital` from deployment allocation
   * and open notional so it matches `applyEntry` economics (long: −notional − fee; short: +notional − fee).
   */
  private recomputeAvailableFromAllocatedAndSnapshot(symbol: string): void {
    const r = this.runtimes.get(symbol);
    if (!r) return;
    const allocated = r.allocatedCapital;
    const q = r.currentPositionQty;
    const avg = r.avgEntryPrice;
    const eps = 1e-12;
    if (Math.abs(q) < eps) {
      r.setCapitalAllocation(allocated, allocated);
      return;
    }
    const qtyAbs = Math.abs(q);
    const notional = qtyAbs * avg;
    const fr = this.effectiveFeeRate(symbol);
    const fee = fr > 0 ? notional * fr : 0;
    const available =
      q > 0 ? allocated - notional - fee : allocated + notional - fee;
    const clamped = Number.isFinite(available) ? Math.max(0, available) : allocated;
    r.setCapitalAllocation(allocated, clamped);
  }

  setCapitalAllocation(symbol: string, total: number, available: number): void {
    this.runtimeFor(symbol).setCapitalAllocation(total, available);
  }

  getSnapshot(symbol: string): PositionBookSnapshot {
    const r = this.runtimes.get(symbol);
    if (!r) return emptyPositionBookSnapshot();
    return {
      currentPositionQty: r.currentPositionQty,
      avgEntryPrice: r.avgEntryPrice,
      unrealizedPnL: r.unrealizedPnL,
      allocatedCapital: r.allocatedCapital,
      availableCapital: r.availableCapital,
    };
  }

  getCloseOrderSide(symbol: string): 'Buy' | 'Sell' | null {
    return this.runtimes.get(symbol)?.getCloseOrderSide() ?? null;
  }

  /** After restore — seed runtime from persisted open row before venue sync. */
  hydrateFromStoredRow(symbol: string, row: PositionRecord): void {
    this.setPositionSnapshot(
      symbol,
      row.side,
      row.qty,
      row.avgEntryPrice ?? 0,
      0,
    );
  }

  getOpenPositionId(symbol: string): string | undefined {
    return this.bySymbol.get(symbol)?.positionRowId;
  }

  getDetails(symbol: string): RegistryEntry | undefined {
    return this.bySymbol.get(symbol);
  }
}
