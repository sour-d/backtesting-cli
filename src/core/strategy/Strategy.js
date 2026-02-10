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
    this._buyFirst = false; // Alternates buy/sell check order to avoid directional bias
    this._lastPrices = new Map(); // Last known close price per symbol (for equity calc)

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

  /**
   * Check whether the current candle has breached the stop loss.
   * If so, exit the position at the stop-loss price.
   * Returns true if the stop loss was triggered.
   */
  checkStopLoss() {
    if (!this.currentTrade) return false;

    const today = this.stock.now();
    if (!today) return false;

    const { stopLoss, type, quantity } = this.currentTrade;
    if (stopLoss == null) return false;

    if (type === "Buy" && today.low <= stopLoss) {
      // Long stop loss hit: exit at the stop-loss price
      this.exitPosition(stopLoss, quantity);
      return true;
    }

    if (type === "Sell" && today.high >= stopLoss) {
      // Short stop loss hit: exit at the stop-loss price
      this.exitPosition(stopLoss, quantity);
      return true;
    }

    return false;
  }

  trade() {
    if (this.capital <= 0) return; // Skip if capital exhausted

    // --- Enforce stop loss before any strategy-level exit logic ---
    if (this.currentTrade && this.checkStopLoss()) return;

    if (this.currentTrade?.type === "Buy") return this.longSquareOff();
    if (this.currentTrade?.type === "Sell") return this.shortSquareOff();

    // Alternate buy/sell check order to avoid directional bias
    if (this._buyFirst) {
      if (Boolean(this.buy())) return;
      if (Boolean(this.sell())) return;
    } else {
      if (Boolean(this.sell())) return;
      if (Boolean(this.buy())) return;
    }
    this._buyFirst = !this._buyFirst;
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

    // Track last known close price for equity calculation
    const currentCandle = stock.now();
    if (currentCandle?.close != null) {
      this._lastPrices.set(symbol, currentCandle.close);
    }

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

    // Compute market-value equity for open positions using last known prices
    const openPositions = {};
    let totalLocked = 0;
    for (const [symbol, trade] of this.currentTrades) {
      const currentPrice = this._lastPrices.get(symbol) ?? trade.price;
      // Market value = what you'd get by closing the position now
      let marketValue;
      let unrealizedPnL;
      if (trade.type === "Sell") {
        // Short: closing returns collateral + P&L = qty * (2 * entry - current)
        marketValue = trade.quantity * (2 * trade.price - currentPrice);
        unrealizedPnL = trade.quantity * (trade.price - currentPrice);
      } else {
        // Long: closing returns qty * currentPrice
        marketValue = trade.quantity * currentPrice;
        unrealizedPnL = trade.quantity * (currentPrice - trade.price);
      }

      openPositions[symbol] = {
        type: trade.type,
        quantity: trade.quantity,
        entryPrice: trade.price,
        currentPrice,
        unrealizedPnL,
        locked: marketValue,
      };
      totalLocked += marketValue;
    }

    return {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        capital: totalCash,            // Available cash (excl. open positions)
        totalLocked,                   // Market value of open positions
        totalEquity: totalCash + totalLocked, // True equity: cash + market value
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
