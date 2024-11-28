import { ExistingQuoteStorage } from "../quoteStorage/ExistingQuoteStorage.js";
import { Trades } from "../outcome/Trades.js";
import { getStockData, transformStockData } from "../parser/restructureData.js";

class Strategy {
  stock;
  capital;
  riskPercentage;
  trades;
  persistTradesFn;
  currentTrade;
  risk;
  stockName;

  constructor(
    stockName,
    persistTradesFn,
    config = Strategy.getDefaultConfig()
  ) {
    this.capital = config.capital;
    this.riskPercentage = config.riskPercentage;
    this.persistTradesFn = persistTradesFn;
    this.risk = this.capital * (this.riskPercentage / 100);
    this.stockName = stockName;

    this.currentTrade = null;

    this.stock = new ExistingQuoteStorage(getStockData(stockName), 20);
    this.trades = new Trades(this);
    // this.isLive = stock instanceof LiveQuoteStorage;
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5,
      leverage: 1,
    };
  }

  stocksCanBeBought(riskForOneStock, buyingPrice) {
    return this.risk / riskForOneStock;
    // const maxStocksByCapital = this.capital * this.config.leverage / buyingPrice;
    // const maxStocksByRisk = this.risk / riskForOneStock;

    // const totalCost = maxStocksByRisk * buyingPrice;
    // const affordableStocks =
    //   totalCost <= this.capital ? maxStocksByRisk : maxStocksByCapital;

    // return +affordableStocks.toFixed(2);
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
    throw new Error("Method not implemented.");
  }

  sell() {
    throw new Error("Method not implemented.");
  }

  squareOff() {
    throw new Error("Method not implemented.");
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
    // if (this.capital * this.config.leverage <= 0) throw new Error("Capital exhausted");
    if (this.currentTrade?.type === "Buy") return this.longSquareOff();
    if (this.currentTrade?.type === "Sell") return this.shortSquareOff();

    if (this.sell()) return;
    if (this.buy()) return;
  }

  execute() {
    while (this.stock.hasData() && this.stock.move()) {
      this.trade();
    }

    const result = {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
    };
    this.persistTradesFn(result);
  }

  static indicators() {
    throw new Error("Method not implemented.");
  }
}

export { Strategy };
