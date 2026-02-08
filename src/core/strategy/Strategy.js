import { Trades } from "../trades/Trades.js";

class Strategy {
  stock; // Set per-instrument by tradeOnce()
  capital; // Active instrument's capital during tradeOnce()
  riskPercentage;
  maxAllocation;
  trades;
  currentTrades; // Map<symbol, trade> for multi-instrument tracking
  capitalPool; // Map<symbol, number> for per-instrument isolated capital

  constructor(config = Strategy.getDefaultConfig()) {
    this.capital = config.capital;
    this.initialCapital = config.capital; // Preserve for results
    this.riskPercentage = config.riskPercentage;
    this.maxAllocation = config.maxAllocation || 0.3; // Max % of instrument capital per trade
    this.capitalPool = new Map(); // Populated by allocateCapital()
    this.currentTrades = new Map(); // Per-symbol open positions
    this.currentTrade = null; // Alias for current symbol's trade during tradeOnce
    this.stock = null;

    this.trades = new Trades({
      capital: this.capital,
      risk: this.riskPercentage,
    });
  }

  /**
   * Divide total capital equally among the given instruments.
   * Must be called after the strategy is created and instruments are known.
   */
  allocateCapital(symbols) {
    const perInstrument = this.initialCapital / symbols.length;
    this.capitalPool = new Map();
    for (const symbol of symbols) {
      this.capitalPool.set(symbol, perInstrument);
    }
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5,
      maxAllocation: 0.3, // 30% max capital per single trade
    };
  }

  static getIndicators() {
    throw new Error("getIndicators() must be implemented by subclass.");
  }

  stocksCanBeBought(riskForOneStock, buyingPrice) {
    // Dynamic risk: recalculate based on current capital each trade
    const risk = this.capital * (this.riskPercentage / 100);

    // Cap: max allocation per trade (e.g., 30% of current capital)
    const maxCapitalForTrade = this.capital * this.maxAllocation;
    const maxStocksByAllocation = maxCapitalForTrade / buyingPrice;

    const maxStocksByRisk = risk / riskForOneStock;

    // Position is the smallest of: risk-based, allocation-capped
    const position = Math.min(maxStocksByRisk, maxStocksByAllocation);

    // Also ensure we can afford it
    const maxStocksByCapital = this.capital / buyingPrice;
    const affordableStocks = Math.min(position, maxStocksByCapital);

    return +affordableStocks.toFixed(2) - 0.01;
  }

  updateTrades(transactionDate, price, quantity, risk, transactionType = "buy", symbol) {
    this.trades.addTradeResult(
      transactionDate,
      price,
      quantity,
      risk,
      transactionType,
      symbol
    );
  }

  buy() {
    throw new Error("buy() must be implemented by subclass.");
  }

  sell() {
    throw new Error("sell() must be implemented by subclass.");
  }

  longSquareOff() {
    throw new Error("longSquareOff() must be implemented by subclass.");
  }

  shortSquareOff() {
    throw new Error("shortSquareOff() must be implemented by subclass.");
  }

  takePosition(risk, price, transactionType = "Buy") {
    if (risk <= 0) return;
    if (this.capital <= 0) return; // No capital left to trade

    const stockCanBeBought = this.stocksCanBeBought(risk, price);
    if (stockCanBeBought <= 0) return; // Can't afford any position

    const position = stockCanBeBought;
    this.capital -= position * price;

    this.currentTrade = {
      transactionDate: this.stock.now(),
      price,
      quantity: position,
      risk,
      type: transactionType,
      stopLoss: transactionType === "Buy" ? price - risk : price + risk,
      symbol: this._currentSymbol,
    };

    // Store in per-symbol map
    this.currentTrades.set(this._currentSymbol, this.currentTrade);

    this.updateTrades(
      this.stock.now(),
      price,
      Math.abs(position),
      risk * position,
      transactionType,
      this._currentSymbol
    );
  }

  exitPosition(price, position = this.currentTrade?.quantity || 0, type = "square-off") {
    if (!this.currentTrade) throw new Error("No position to square off");
    if (position > this.currentTrade.quantity)
      throw new Error("Invalid position to square off");

    if (this.currentTrade.type === "Sell") {
      // Short exit: return collateral + P&L
      // Collateral locked at entry = qty * entryPrice
      // Short P&L = qty * (entryPrice - exitPrice)
      // Total returned = qty * (2 * entryPrice - exitPrice)
      this.capital += position * (2 * this.currentTrade.price - price);
    } else {
      // Long exit: receive sale proceeds
      this.capital += position * price;
    }
    this.updateTrades(this.stock.now(), price, Math.abs(position), 0, type, this._currentSymbol);

    if (position !== this.currentTrade.quantity) {
      this.currentTrade.quantity -= position;
      this.currentTrades.set(this._currentSymbol, this.currentTrade);
      return;
    }

    this.currentTrade = null;
    this.currentTrades.delete(this._currentSymbol);
  }

  trade() {
    if (this.capital <= 0) return; // Skip if capital exhausted
    if (this.currentTrade?.type === "Buy") return this.longSquareOff();
    if (this.currentTrade?.type === "Sell") return this.shortSquareOff();

    if (Boolean(this.sell())) return;
    if (Boolean(this.buy())) return;
  }

  /**
   * Execute one day of strategy logic on one instrument.
   * Called by the Bot for each instrument on each simulated day.
   *
   * Loads this instrument's isolated capital into this.capital so all
   * position-sizing / entry / exit logic works unchanged, then saves
   * the updated value back to the capitalPool.
   */
  tradeOnce(stock, symbol) {
    this._currentSymbol = symbol;
    this.stock = stock;
    this.currentTrade = this.currentTrades.get(symbol) || null;

    // Load per-instrument capital (falls back to shared capital if not allocated)
    if (this.capitalPool.size > 0) {
      this.capital = this.capitalPool.get(symbol) ?? 0;
    }

    try {
      this.trade();
    } catch (error) {
      console.error(`Strategy error on ${symbol}:`, error.message);
    }

    // Save per-instrument capital back
    if (this.capitalPool.size > 0) {
      this.capitalPool.set(symbol, this.capital);
    }

    // Sync back any changes to currentTrade
    if (this.currentTrade) {
      this.currentTrades.set(symbol, this.currentTrade);
    }
  }

  /**
   * Return the total capital across all instrument pools,
   * or the single capital value if pools are not allocated.
   */
  getTotalCapital() {
    if (this.capitalPool.size > 0) {
      return [...this.capitalPool.values()].reduce((sum, c) => sum + c, 0);
    }
    return this.capital;
  }

  getResults() {
    const totalCash = this.getTotalCapital();
    const capitalPerInstrument =
      this.capitalPool.size > 0
        ? Object.fromEntries(this.capitalPool)
        : null;

    // Compute capital locked in open positions
    const openPositions = {};
    let totalLocked = 0;
    for (const [symbol, trade] of this.currentTrades) {
      const locked = trade.quantity * trade.price;
      openPositions[symbol] = {
        type: trade.type,
        quantity: trade.quantity,
        entryPrice: trade.price,
        locked,
      };
      totalLocked += locked;
    }

    return {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        capital: totalCash,            // Available cash (excl. open positions)
        totalLocked,                   // Capital locked in open positions
        totalEquity: totalCash + totalLocked, // Cash + locked
        initialCapital: this.initialCapital,
        riskPercentage: this.riskPercentage,
        totalOpenPositions: this.currentTrades.size,
        openPositions,
        capitalPerInstrument,
      },
    };
  }
}

export { Strategy };
export default Strategy;
