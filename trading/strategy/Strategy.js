import { ExistingQuoteStorage } from "../quoteStorage/ExistingQuoteStorage.js";
import { Trades } from "../outcome/Trades.js";
import { EventEmitter } from "events";
import { getStockData, transformStockData } from "../parser/restructureData.js";
import { type } from "os";

class Strategy extends EventEmitter {
  stock;
  capital;
  riskPercentage;
  trades;
  persistTradesFn;
  currentTradeInfo;
  risk;
  stockName;

  constructor(
    stockName,
    persistTradesFn,
    config = Strategy.getDefaultConfig()
  ) {
    super();

    this.capital = config.capital;
    this.riskPercentage = config.riskPercentage;
    this.persistTradesFn = persistTradesFn;
    this.risk = this.capital * (this.riskPercentage / 100);
    this.stockName = stockName;

    this.currentTradeInfo = null;

    this.stock = new ExistingQuoteStorage(getStockData(stockName));
    this.trades = new Trades(this);
    // this.isLive = stock instanceof LiveQuoteStorage;
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5,
    };
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
    throw new Error("Method not implemented.");
  }

  sell() {
    throw new Error("Method not implemented.");
  }

  squareOff() {
    throw new Error("Method not implemented.");
  }

  takePosition(risk, price, transactionType = "buy") {
    if (risk <= 0) return;
    const stockCanBeBought = this.stocksCanBeBought(risk, price);
    const position =
      transactionType === "buy" ? stockCanBeBought : stockCanBeBought * -1;
    this.capital -= stockCanBeBought * price;

    this.currentTradeInfo = {
      transactionDate: this.stock.now(),
      price,
      position,
      risk,
      type: transactionType,
    };

    this.updateTrades(
      this.stock.now(),
      price,
      position,
      risk * position,
      transactionType
    );
  }

  exitPosition(
    price,
    position = this.currentTradeInfo?.position || 0,
    type = "square-off"
  ) {
    if (!this.currentTradeInfo) return;

    this.capital += position * price;
    this.updateTrades(this.stock.now(), price, position, 0, type);

    this.currentTradeInfo = null;
  }

  trade() {
    this.emit("data", this.stock.now());

    if (this.currentTradeInfo?.position > 0) return this.squareOff();
    if (this.currentTradeInfo?.position < 0) return this.squareOff();

    if (this.sell()) return;
    if (this.buy()) return;
  }

  execute() {
    // if (this.stock instanceof LiveQuoteStorage) {
    //   this.stock.subscribe(() => this.trade());
    //   const intervalId = setInterval(() => {
    //     const trades = this.trades.flush();
    //     if (trades) this.persistTradesFn(trades);
    //   }, 5000);
    //   return;
    // }

    if (this.stock instanceof ExistingQuoteStorage) {
      while (this.stock.hasData() && this.stock.move()) {
        this.trade();
      }
      this.persistTradesFn(this.trades);
    }
  }
}

export { Strategy };
