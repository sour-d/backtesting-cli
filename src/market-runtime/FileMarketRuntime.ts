import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KlineIntervalV3 } from "bybit-api";
import type { Candle } from "../core/types.js";
import type { Instrument } from "../instrument/Instrument.js";
import { defaultInstrumentStaticForBacktest } from "../instrument/defaultInstrumentStatic.js";
import type {
  InstrumentCategory,
  InstrumentStatic,
} from "../instrument/types.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IStore } from "../store/IStore.js";
import type { CandleHandler, IMarketRuntime } from "./IMarketRuntime.js";
import { mergeReplayTimestamps } from "./mergeReplayTimestamps.js";

function isCandleRow(o: unknown): o is Candle {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.dateUnix === "number" &&
    typeof r.open === "number" &&
    typeof r.high === "number" &&
    typeof r.low === "number" &&
    typeof r.close === "number" &&
    typeof r.volume === "number"
  );
}

function parseInstrumentJson(
  symbol: string,
  raw: unknown,
  category: InstrumentCategory,
): InstrumentStatic {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid instrument JSON for ${symbol}`);
  }
  const o = raw as Record<string, unknown>;
  return {
    symbol: typeof o.symbol === "string" ? o.symbol : symbol,
    category:
      o.category === "linear" ||
      o.category === "spot" ||
      o.category === "inverse"
        ? o.category
        : category,
    tickSize: Number(o.tickSize),
    stepSize: Number(o.stepSize),
    minQty: Number(o.minQty),
    minNotional: Number(o.minNotional),
    pricePrecision: Number(o.pricePrecision),
    qtyPrecision: Number(o.qtyPrecision),
  };
}

function parseJsonlCandles(raw: string, filePath: string): Candle[] {
  const out: Candle[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const o = JSON.parse(t) as unknown;
    if (!isCandleRow(o)) {
      throw new Error(`Invalid candle line in ${filePath}`);
    }
    out.push(o);
  }
  out.sort((a, b) => a.dateUnix - b.dateUnix);
  return out;
}

export interface ParsedMarketFile {
  readonly instrument?: InstrumentStatic;
  readonly candles: Candle[];
}

/**
 * Supports:
 * - JSON array of candles
 * - JSON object `{ "instrument"?: {...}, "candles": [...] }`
 * - JSONL (one candle JSON per line) when content does not start with `[` or `{`
 */
export function parseMarketFileContent(
  raw: string,
  symbol: string,
  category: InstrumentCategory,
  filePath: string,
): ParsedMarketFile {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array in ${filePath}`);
    }
    const candles: Candle[] = [];
    for (const row of parsed) {
      if (!isCandleRow(row)) {
        throw new Error(`Invalid candle in array ${filePath}`);
      }
      candles.push(row);
    }
    candles.sort((a, b) => a.dateUnix - b.dateUnix);
    return { candles };
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    let instrument: InstrumentStatic | undefined;
    if (
      parsed.instrument !== undefined &&
      typeof parsed.instrument === "object"
    ) {
      instrument = parseInstrumentJson(symbol, parsed.instrument, category);
    }
    const rawCandles = parsed.candles;
    if (!Array.isArray(rawCandles)) {
      throw new Error(`Missing "candles" array in ${filePath}`);
    }
    const candles: Candle[] = [];
    for (const row of rawCandles) {
      if (!isCandleRow(row)) {
        throw new Error(`Invalid candle in candles[] ${filePath}`);
      }
      candles.push(row);
    }
    candles.sort((a, b) => a.dateUnix - b.dateUnix);
    return { instrument, candles };
  }
  return { candles: parseJsonlCandles(raw, filePath) };
}

export interface FileMarketRuntimeOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly dataDir: string;
  readonly category: InstrumentCategory;
  readonly klineInterval: KlineIntervalV3;
  readonly warmupCandles: number;
  readonly rangeStartMs: number;
  readonly rangeEndMs: number;
}

/**
 * Replays candles from `{dataDir}/market/{SYMBOL}_{INTERVAL}.json`
 * (same interval string as `quantlab.config.js`, e.g. `240`).
 * Optional `{SYMBOL}_{INTERVAL}.instrument.json` if the market file has no `instrument` field
 * (e.g. bare JSON array or JSONL-only file).
 */
export class FileMarketRuntime implements IMarketRuntime {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly dataDir: string;
  private readonly category: InstrumentCategory;
  private readonly klineInterval: KlineIntervalV3;
  private readonly warmupCandles: number;
  private readonly rangeStartMs: number;
  private readonly rangeEndMs: number;

  private readonly instruments = new Map<string, Instrument>();
  private readonly replayBySymbol = new Map<string, Map<number, Candle>>();
  private readonly handlers: CandleHandler[] = [];
  private started = false;

  /** Avoid reading/parsing the same market file twice per symbol (`fetchInstrumentStatic` + `registerInstrument`). */
  private readonly marketCache = new Map<string, ParsedMarketFile>();

  constructor(opts: FileMarketRuntimeOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.dataDir = opts.dataDir;
    this.category = opts.category;
    this.klineInterval = opts.klineInterval;
    this.warmupCandles = opts.warmupCandles;
    this.rangeStartMs = opts.rangeStartMs;
    this.rangeEndMs = opts.rangeEndMs;
  }

  private marketPath(rel: string): string {
    return join(this.dataDir, "market", rel);
  }

  /** Base name: `BTCUSDT_240` */
  private marketBasename(symbol: string): string {
    return `${symbol}_${this.klineInterval}`;
  }

  private marketDataPath(symbol: string): string {
    return this.marketPath(`${this.marketBasename(symbol)}.json`);
  }

  private marketInstrumentSidecarPath(symbol: string): string {
    return this.marketPath(`${this.marketBasename(symbol)}.instrument.json`);
  }

  private async loadMarket(symbol: string): Promise<ParsedMarketFile> {
    const cached = this.marketCache.get(symbol);
    if (cached) {
      return cached;
    }

    const primary = this.marketDataPath(symbol);
    let raw: string;
    try {
      raw = await readFile(primary, "utf8");
    } catch {
      throw new Error(
        `Market file not found: ${primary} (expected {symbol}_{interval}.json under market/)`,
      );
    }

    let parsed = parseMarketFileContent(raw, symbol, this.category, primary);

    if (!parsed.instrument) {
      try {
        const instRaw = await readFile(
          this.marketInstrumentSidecarPath(symbol),
          "utf8",
        );
        parsed = {
          ...parsed,
          instrument: parseInstrumentJson(
            symbol,
            JSON.parse(instRaw) as unknown,
            this.category,
          ),
        };
      } catch {
        /* optional sidecar */
      }
    }

    if (!parsed.instrument) {
      this.logger.warn(
        'No instrument metadata — using generic backtest defaults (embed "instrument" in market JSON or add sidecar for exchange-accurate sizing)',
        {
          symbol,
          marketFile: primary,
          sidecarExample: this.marketInstrumentSidecarPath(symbol),
        },
      );
      parsed = {
        ...parsed,
        instrument: defaultInstrumentStaticForBacktest(symbol, this.category),
      };
    }

    this.marketCache.set(symbol, parsed);
    return parsed;
  }

  onCandle(handler: CandleHandler): void {
    this.handlers.push(handler);
  }

  getInstrument(symbol: string): Instrument | undefined {
    return this.instruments.get(symbol);
  }

  async fetchInstrumentStatic(symbol: string): Promise<InstrumentStatic> {
    const { instrument } = await this.loadMarket(symbol);
    return instrument!;
  }

  async registerInstrument(instrument: Instrument): Promise<void> {
    const { symbol } = instrument;
    if (this.instruments.has(symbol)) {
      throw new Error(`Instrument already registered: ${symbol}`);
    }

    const { candles } = await this.loadMarket(symbol);

    const sorted = [...candles].sort((a, b) => a.dateUnix - b.dateUnix);
    const inRange = (c: Candle): boolean =>
      c.dateUnix >= this.rangeStartMs && c.dateUnix <= this.rangeEndMs;
    const firstInRangeIdx = sorted.findIndex(inRange);

    let warmupSlice: Candle[] = [];
    if (this.warmupCandles > 0) {
      if (firstInRangeIdx > 0) {
        const start = Math.max(0, firstInRangeIdx - this.warmupCandles);
        warmupSlice = sorted.slice(start, firstInRangeIdx);
      } else if (firstInRangeIdx === 0) {
        /** File starts inside the backtest window — peel first N in-range bars for indicators only. */
        const inRangeSorted = sorted.filter(inRange);
        const n = Math.min(this.warmupCandles, inRangeSorted.length);
        warmupSlice = inRangeSorted.slice(0, n);
      }
    }

    for (const c of warmupSlice) {
      instrument.addCandle(c);
    }

    const warmupTs = new Set(warmupSlice.map((c) => c.dateUnix));
    const replay = new Map<number, Candle>();
    for (const c of candles) {
      if (!inRange(c)) continue;
      if (warmupTs.has(c.dateUnix)) continue;
      replay.set(c.dateUnix, c);
    }
    this.replayBySymbol.set(symbol, replay);

    instrument.setReady(true);
    this.instruments.set(symbol, instrument);

    this.logger.info("FileMarketRuntime instrument registered", {
      symbol,
      warmup: warmupSlice.length,
      replayBars: replay.size,
      interval: this.klineInterval,
      file: this.marketDataPath(symbol),
    });
  }

  async unregisterInstrument(_symbol: string): Promise<void> {
    /* no-op for backtest */
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const timeline = mergeReplayTimestamps(this.replayBySymbol);
    this.logger.info("FileMarketRuntime replay start", {
      bars: timeline.length,
    });

    for (const t of timeline) {
      for (const [symbol, replay] of this.replayBySymbol) {
        const candle = replay.get(t);
        if (!candle) continue;
        const instrument = this.instruments.get(symbol);
        if (!instrument?.ready) continue;
        await this.runPipeline(instrument, candle);
      }
    }

    this.logger.info("FileMarketRuntime replay complete");
  }

  /**
   * After replay, write full in-memory enriched series (warmup + replay bars) to
   * `{dataDir}/technical/{SYMBOL}_{interval}.json` for inspection / parity with legacy technical dumps.
   */
  async writeEnrichedTechnicalDumps(): Promise<void> {
    const technicalDir = join(this.dataDir, "technical");
    await mkdir(technicalDir, { recursive: true });
    const interval = this.klineInterval;
    for (const [symbol, instrument] of this.instruments) {
      const candles = instrument.getCandles();
      const filePath = join(technicalDir, `${symbol}_${interval}.json`);
      await writeFile(filePath, JSON.stringify(candles, null, 2), "utf8");
      this.logger.info("Enriched technical dump written", {
        path: filePath,
        bars: candles.length,
      });
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.logger.info("FileMarketRuntime stopped");
  }

  private async runPipeline(
    instrument: Instrument,
    candle: Candle,
  ): Promise<void> {
    instrument.addCandle(candle);
    const enriched = instrument.getCandles(1)[0]!;
    await this.store.saveCandle(instrument.symbol, candle, {
      ...enriched.indicators,
    });
    this.logger.debug("Candle pipeline", {
      symbol: instrument.symbol,
      dateUnix: candle.dateUnix,
      indicatorKeys: Object.keys(enriched.indicators),
    });
    for (const h of this.handlers) {
      await Promise.resolve(h(instrument, enriched));
    }
  }
}
