import { describe, it, expect } from "vitest";
import Bot from "../../src/core/strategy/Bot.js";
import TestStrategy from "../fixtures/TestStrategy.js";
import { createMockMarket } from "../fixtures/mockMarket.js";
import {
  generateOHLC,
  TESTA_PATTERN,
  TESTB_PATTERN,
} from "../fixtures/mockOHLC.js";
import {
  transformTradesData,
  aggregateLog,
} from "../../src/core/results/transformResult.js";
import Strategy from "../../src/core/strategy/Strategy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a standard 2-instrument mock market used by most tests.
 */
function createStandardMarket() {
  const testaOHLC = generateOHLC(30, {
    basePrice: 100,
    pattern: TESTA_PATTERN,
  });
  const testbOHLC = generateOHLC(30, {
    basePrice: 200,
    pattern: TESTB_PATTERN,
  });

  return createMockMarket({ TESTA: testaOHLC, TESTB: testbOHLC });
}

/**
 * Run a full simulation with the given market and strategy class.
 */
async function runPipeline(market, StrategyClass = TestStrategy) {
  const bot = new Bot(market, StrategyClass);
  await bot.initialize();
  const completedDays = await bot.runSimulation();
  const results = bot.getResults();
  return { bot, completedDays, results, strategy: bot.strategy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Backtesting Pipeline Integration", () => {
  // ---- Test 1 -----------------------------------------------------------
  it("Full pipeline produces correct trades", async () => {
    const market = createStandardMarket();
    const { completedDays, results, strategy } = await runPipeline(market);

    // 10 trading days (candle indices 20-29 inclusive)
    expect(completedDays).toBe(10);

    const raw = results.tradeResults;

    // Each instrument produces 4 complete round-trips (entry + exit = 2 records each)
    // plus 1 open entry at day 29.  Total: (4*2 + 1) * 2 = 18
    expect(raw.length).toBe(18);

    // Every raw trade must have a symbol
    const symbols = new Set(raw.map((t) => t.symbol));
    expect(symbols).toEqual(new Set(["TESTA", "TESTB"]));

    // No cross-instrument contamination: each entry/exit pair for a symbol
    // must reference that symbol only
    const testaRaw = raw.filter((t) => t.symbol === "TESTA");
    const testbRaw = raw.filter((t) => t.symbol === "TESTB");
    expect(testaRaw.length).toBe(9); // 4*2 + 1 open
    expect(testbRaw.length).toBe(9);

    // aggregateLog produces 4 completed trades per instrument = 8 total
    const aggregated = aggregateLog(raw);
    expect(aggregated.length).toBe(8);

    // Each aggregated trade must carry its symbol
    for (const trade of aggregated) {
      expect(["TESTA", "TESTB"]).toContain(trade.symbol);
    }
  });

  // ---- Test 2 -----------------------------------------------------------
  it("Capital accounting is correct", async () => {
    const market = createStandardMarket();
    const { results, strategy } = await runPipeline(market);

    const raw = results.tradeResults;
    const initialCapital = TestStrategy.getDefaultConfig().capital;
    const numInstruments = 2;
    const perInstrument = initialCapital / numInstruments;

    // Rebuild expected capital per-instrument from trade records.
    // With isolated capital, each symbol has its own pool.
    const perSymbolCapital = new Map();
    perSymbolCapital.set("TESTA", perInstrument);
    perSymbolCapital.set("TESTB", perInstrument);

    const openPositions = new Map();
    for (const t of raw) {
      let cap = perSymbolCapital.get(t.symbol);
      if (t.transactionType === "Buy" || t.transactionType === "Sell") {
        cap -= t.quantity * t.price;
        openPositions.set(t.symbol, {
          type: t.transactionType,
          entryPrice: t.price,
        });
      } else {
        // square-off
        const pos = openPositions.get(t.symbol);
        if (pos && pos.type === "Sell") {
          cap += t.quantity * (2 * pos.entryPrice - t.price);
        } else {
          cap += t.quantity * t.price;
        }
        openPositions.delete(t.symbol);
      }
      perSymbolCapital.set(t.symbol, cap);
    }

    const expectedTotal = [...perSymbolCapital.values()].reduce(
      (s, c) => s + c,
      0
    );

    expect(strategy.getTotalCapital()).toBeCloseTo(expectedTotal, 0);

    // Per-instrument pools must match
    for (const [sym, expectedCap] of perSymbolCapital) {
      const actualCap = strategy.capitalPool.get(sym);
      expect(actualCap).toBeCloseTo(expectedCap, 0);
    }

    // No negative quantities or phantom trades
    for (const t of raw) {
      expect(t.quantity).toBeGreaterThan(0);
      expect(t.price).toBeGreaterThan(0);
    }

    // Open positions should exist at end (day 29 entries)
    expect(strategy.currentTrades.size).toBe(2);
  });

  // ---- Test 3 -----------------------------------------------------------
  it("Multi-instrument trades stay isolated", async () => {
    const market = createStandardMarket();
    const { results } = await runPipeline(market);

    const raw = results.tradeResults;

    // On day 21 (index 21 = Jan 22, 2024):
    //   TESTA triggers Buy, TESTB triggers Sell
    const day21Date = new Date(2024, 0, 22).toISOString().split("T")[0];

    const day21Entries = raw.filter(
      (t) =>
        t.transactionDate?.date === day21Date &&
        (t.transactionType === "Buy" || t.transactionType === "Sell")
    );

    expect(day21Entries.length).toBe(2);

    const testaBuy = day21Entries.find((t) => t.symbol === "TESTA");
    const testbSell = day21Entries.find((t) => t.symbol === "TESTB");

    expect(testaBuy).toBeDefined();
    expect(testaBuy.transactionType).toBe("Buy");

    expect(testbSell).toBeDefined();
    expect(testbSell.transactionType).toBe("Sell");

    // Verify aggregateLog pairs them correctly (the -43M bug regression test)
    const aggregated = aggregateLog(raw);
    for (const trade of aggregated) {
      // Entry and exit must be for the same symbol -- checked by
      // the fact that aggregateLog stores the symbol at open time
      expect(trade.symbol).toBeDefined();
      expect(["TESTA", "TESTB"]).toContain(trade.symbol);
    }

    // Verify no trade has a P&L that crosses instruments:
    // entry price and exit price should be in the same price band
    // (TESTA ~100-120, TESTB ~200-220)
    for (const trade of aggregated) {
      if (trade.symbol === "TESTA") {
        expect(trade.entryPrice).toBeLessThan(150);
        expect(trade.exitPrice).toBeLessThan(150);
      } else {
        expect(trade.entryPrice).toBeGreaterThan(150);
        expect(trade.exitPrice).toBeGreaterThan(150);
      }
    }
  });

  // ---- Test 4 -----------------------------------------------------------
  it("aggregateLog handles interleaved multi-instrument trades", () => {
    // Hand-crafted interleaved trade data
    const interleavedTrades = [
      // TESTA opens a long
      {
        price: 100,
        quantity: 10,
        risk: 40,
        transactionType: "Buy",
        symbol: "TESTA",
        transactionDate: { date: "2024-01-01" },
      },
      // TESTB opens a short (interleaved)
      {
        price: 200,
        quantity: 5,
        risk: 20,
        transactionType: "Sell",
        symbol: "TESTB",
        transactionDate: { date: "2024-01-01" },
      },
      // TESTA closes
      {
        price: 105,
        quantity: 10,
        risk: 0,
        transactionType: "square-off",
        symbol: "TESTA",
        transactionDate: { date: "2024-01-02" },
      },
      // TESTB closes
      {
        price: 195,
        quantity: 5,
        risk: 0,
        transactionType: "square-off",
        symbol: "TESTB",
        transactionDate: { date: "2024-01-02" },
      },
    ];

    const result = aggregateLog(interleavedTrades);

    expect(result).toHaveLength(2);

    // First aggregated trade should be TESTA (Long)
    expect(result[0].symbol).toBe("TESTA");
    expect(result[0].entryPrice).toBe(100);
    expect(result[0].exitPrice).toBe(105);
    expect(result[0].type).toBe("Long");

    // Second aggregated trade should be TESTB (Short)
    expect(result[1].symbol).toBe("TESTB");
    expect(result[1].entryPrice).toBe(200);
    expect(result[1].exitPrice).toBe(195);
    expect(result[1].type).toBe("Short");

    // Critically: the -43M bug was caused by pairing TESTA entry with TESTB exit.
    // Verify that TESTA P&L uses TESTA prices only:
    const testaPnL =
      (result[0].exitPrice - result[0].entryPrice) * result[0].quantity;
    expect(testaPnL).toBe(50); // (105 - 100) * 10 = 50

    // And TESTB P&L uses TESTB prices only:
    const testbPnL =
      (result[1].entryPrice - result[1].exitPrice) * result[1].quantity;
    expect(testbPnL).toBe(25); // (200 - 195) * 5 = 25
  });

  // ---- Test 5 -----------------------------------------------------------
  it("Capital guard prevents trading with zero capital", async () => {
    // Strategy with tiny capital and expensive instruments
    class LowCapitalStrategy extends TestStrategy {
      constructor() {
        super({ capital: 10, riskPercentage: 5 });
      }
      static strategyName = "LowCapitalStrategy";
      static getIndicators() {
        return [];
      }
      static getDefaultConfig() {
        return { capital: 10, riskPercentage: 5 };
      }
    }

    // Use high base prices so position cost exceeds capital
    const expensiveA = generateOHLC(30, {
      basePrice: 50000,
      pattern: TESTA_PATTERN,
    });
    const expensiveB = generateOHLC(30, {
      basePrice: 60000,
      pattern: TESTB_PATTERN,
    });

    const market = createMockMarket({
      EXPA: expensiveA,
      EXPB: expensiveB,
    });

    const { results, strategy } = await runPipeline(market, LowCapitalStrategy);

    // No trades should have been opened
    expect(results.tradeResults.length).toBe(0);
    expect(strategy.currentTrades.size).toBe(0);

    // Total capital should be unchanged (split across 2 pools, $5 each)
    expect(strategy.getTotalCapital()).toBe(10);
  });
});
