import { ExistingQuoteStorage } from "../storage/ExistingQuoteStorage.js";
import { Trades } from "../tradeSimulator/Trades.js";
import { getStockData, transformStockData } from "../parser/restructureData.js";
import strategy from "./index.js";

class Strategy {
  stock;
  capital;
  riskPercentage;
  trades;
  persistTradesFn;
  currentTrade;
  risk;
  symbol;
  interval;

  constructor(
    symbolInfo,
    persistTradesFn,
    config = Strategy.getDefaultConfig(),
  ) {
    const { symbol, interval } = symbolInfo;
    this.capital = config.capital;
    this.riskPercentage = config.riskPercentage;
    this.persistTradesFn = persistTradesFn;
    this.risk = this.capital * (this.riskPercentage / 100);
    this.symbol = symbol;
    this.interval = interval;
    this.label = symbolInfo.label || `${symbol}_${interval}`;

    this.currentTrade = null;

    this.stock = new ExistingQuoteStorage(getStockData(symbolInfo), 20);
    this.trades = new Trades(this);
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5,
    };
  }

  static getIndicators() {
    throw new Error("getIndicators() Method not implemented.");
  }

  stocksCanBeBought(riskForOneStock, buyingPrice) {
    const maxStocksByCapital = this.capital / buyingPrice;
    const maxStocksByRisk = this.risk / riskForOneStock;

    const totalCost = maxStocksByRisk * buyingPrice;
    const affordableStocks =
      totalCost <= this.capital ? maxStocksByRisk : maxStocksByCapital;

    return +affordableStocks.toFixed(2) - 0.01;

    // when fraction buy is not possible
    // return Math.floor(affordableStocks);
  }

  updateTrades(
    transactionDate,
    price,
    quantity,
    risk,
    transactionType = "buy"
  ) {
    this.trades.addTradeResult(
      transactionDate,
      price,
      quantity,
      risk,
      transactionType
    );
  }

  buy() {
    throw new Error("Buy() Method not implemented.");
  }

  sell() {
    throw new Error("Sell() Method not implemented.");
  }

  longSquareOff() {
    throw new Error("longSquareOff() Method not implemented.");
  }
  shortSquareOff() {
    throw new Error("shortSquareOff() Method not implemented.");
  }

  takePosition(risk, price, transactionType = "Buy") {
    if (risk <= 0) return;
    const stockCanBeBought = this.stocksCanBeBought(risk, price);
    const position = stockCanBeBought;
    this.capital -= stockCanBeBought * price;

    this.currentTrade = {
      transactionDate: this.stock.now(),
      price,
      quantity: position,
      risk,
      type: transactionType,
      stopLoss: transactionType === "Buy" ? price - risk : price + risk,
    };

    this.updateTrades(
      this.stock.now(),
      price,
      Math.abs(position),
      risk * position,
      transactionType
    );
  }

  exitPosition(
    price,
    position = this.currentTrade?.quantity || 0,
    type = "square-off"
  ) {
    if (!this.currentTrade) throw new Error("No position to square off");
    if (position > this.currentTrade.quantity)
      throw new Error("Invalid position to square off");

    this.capital += position * price;
    this.updateTrades(this.stock.now(), price, Math.abs(position), 0, type);
    if (position !== this.currentTrade.quantity) {
      this.currentTrade.quantity -= position;
      return;
    }

    this.currentTrade = null;
  }

  trade() {
    if (this.capital <= 0) throw new Error("Capital exhausted");
    if (this.currentTrade?.type === "Buy") return this.longSquareOff();
    if (this.currentTrade?.type === "Sell") return this.shortSquareOff();

    if (Boolean(this.sell())) return;
    if (Boolean(this.buy())) return;
  }

  execute() {
    while (this.stock.hasData() && this.stock.move()) {
      this.trade();
    }

    const result = {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        symbol: this.symbol,
        interval: this.interval,
        capital: this.capital,
        riskPercentage: this.riskPercentage
      }
    };
    this.persistTradesFn(result);
  }

  static indicators() {
    throw new Error("Method not implemented.");
  }
}

export { Strategy };
