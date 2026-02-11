import { ExistingOHLCStorage } from "../data/OHLCStorage.js";
import { addTechnicalIndicator } from "../data/restructureData.js";
import chalk from "chalk";

class Bot {
  constructor(market, strategyClass, options = {}) {
    this.market = market;
    this.strategyClass = strategyClass;
    this.strategy = null;
    this.instrumentStocks = new Map(); // Map<symbol, ExistingOHLCStorage>
    this.isRunning = false;
    this.logEquity = options.logEquity || false;
    this.equityLog = [];
  }

  /**
   * Step 3 of the pipeline: Initialize strategy and compute indicators.
   * Applies the strategy's indicator pipeline to each instrument's raw OHLC,
   * then wraps enriched data in ExistingOHLCStorage.
   */
  async initialize() {
    if (!this.market.isInitialized()) {
      throw new Error("Market must be initialized before starting bot");
    }

    // Initialize strategy instance
    this.strategy = new this.strategyClass();
    const strategyName = this.strategyClass.strategyName || this.strategyClass.name;
    console.log(chalk.green(`Strategy: ${strategyName}`));

    // Pass the market interval to the trades tracker
    if (this.market.interval) {
      this.strategy.trades.timeFrame = this.market.interval;
    }

    // Get the indicator pipeline from the strategy
    const indicators = this.strategyClass.getIndicators();

    // Apply indicators to each instrument's OHLC data
    const instruments = this.market.getAllInstruments();
    const symbols = Object.keys(instruments);

    console.log(chalk.yellow(`Computing indicators for ${symbols.length} instruments...`));

    for (const symbol of symbols) {
      const instrument = instruments[symbol];
      const rawOHLC = instrument.ohcl;

      if (!rawOHLC || rawOHLC.length === 0) {
        console.warn(chalk.red(`  Skipping ${symbol}: no OHLC data`));
        continue;
      }

      // Apply technical indicators to raw OHLC data
      const enrichedData = addTechnicalIndicator(rawOHLC, indicators);

      // Wrap in ExistingOHLCStorage (start at index 20 to allow indicator warm-up)
      const startIndex = Math.min(20, Math.max(1, enrichedData.length - 1));
      const stock = new ExistingOHLCStorage(enrichedData, startIndex, symbol);
      this.instrumentStocks.set(symbol, stock);
    }

    // Allocate capital only among instruments that actually have data
    const activeSymbols = [...this.instrumentStocks.keys()];
    this.strategy.allocateCapital(activeSymbols);

    console.log(chalk.green(`Indicators computed for ${this.instrumentStocks.size} instruments`));
  }

  /**
   * Step 4: Execute strategy on all instruments for the current day.
   * Advances each instrument's ExistingOHLCStorage and calls strategy.tradeOnce().
   */
  executeStrategyOnInstruments() {
    for (const [symbol, stock] of this.instrumentStocks) {
      if (!stock.hasData()) continue;

      // Advance to next candle
      stock.move();

      // Execute strategy for this instrument at this point in time
      this.strategy.tradeOnce(stock, symbol);
    }
  }

  simulateDay() {
    if (!this.isRunning) return false;

    // Check if any instrument still has data
    const hasData = this.hasRemainingData();
    if (!hasData) {
      this.isRunning = false;
      return false;
    }

    this.currentDayIndex++;

    try {
      this.executeStrategyOnInstruments();
      return true;
    } catch (error) {
      console.error(chalk.red(`Error during day ${this.currentDayIndex} simulation:`), error);
      return false;
    }
  }

  hasRemainingData() {
    for (const [, stock] of this.instrumentStocks) {
      if (stock.hasData()) return true;
    }
    return false;
  }

  getTotalDays() {
    let maxDays = 0;
    for (const [, stock] of this.instrumentStocks) {
      const remaining = stock.ohlc.length - stock.currentOHLCIndex - 1;
      if (remaining > maxDays) maxDays = remaining;
    }
    return maxDays;
  }

  async runSimulation(numberOfDays = null) {
    this.isRunning = true;
    this.currentDayIndex = 0;

    const totalAvailable = this.getTotalDays();
    const daysToRun = numberOfDays || totalAvailable;

    console.log(chalk.blue(`\nSimulating ${daysToRun} day(s) (${totalAvailable} available)...`));

    let completedDays = 0;

    while (this.isRunning && this.hasRemainingData()) {
      const success = this.simulateDay();

      if (!success) break;

      completedDays++;

      // Record equity at end of day if logging enabled
      if (this.logEquity) {
        try {
          const results = this.strategy.getResults();
          // Get current date from any instrument
          const anySymbol = [...this.instrumentStocks.keys()][0];
          const anyStock = this.instrumentStocks.get(anySymbol);
          const currentBar = anyStock.now();
          const date = currentBar?.date;
          if (date) {
            this.equityLog.push({
              date,
              totalEquity: results.metadata.totalEquity
            });
          }
        } catch (e) {
          console.error('Error logging equity:', e.message);
        }
      }

      // Progress logging every 10% or at least every 50 days
      const progressInterval = Math.max(1, Math.floor(daysToRun / 10));
      if (completedDays % progressInterval === 0 || completedDays === daysToRun) {
        const pct = ((completedDays / daysToRun) * 100).toFixed(1);
        process.stdout.write(`\r  Progress: ${pct}% (${completedDays}/${daysToRun} days)`);
      }

      if (numberOfDays && completedDays >= numberOfDays) break;
    }

    // Clear the progress line
    process.stdout.write("\n");

    console.log(chalk.green(`Simulation completed: ${completedDays} day(s)`));
    return completedDays;
  }

  getResults() {
    return this.strategy.getResults();
  }

  getEquityLog() {
    return this.equityLog;
  }

  getStatus() {
    const totalDays = this.getTotalDays();
    return {
      isRunning: this.isRunning,
      currentDayIndex: this.currentDayIndex,
      totalInstruments: this.instrumentStocks.size,
      hasRemainingData: this.hasRemainingData(),
      remainingDays: totalDays,
    };
  }
}

export { Bot };
export default Bot;
