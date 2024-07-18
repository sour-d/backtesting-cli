import { Strategy } from "./Strategy.js";

class PriceActionStrategy extends Strategy {
  config;
  demandZones;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
    this.demandZones = Array(15).fill(null);
  }

  static getDefaultConfig() {
    return {
      capital: 100,
      riskPercentage: 0.1,
    };
  }

  isProfessionalCandle(candle, prevCandle) {
    const prevCandleTotalHeight = prevCandle.high - prevCandle.low;
    const isBodyLarge = candle.close - candle.open > prevCandleTotalHeight;

    return isBodyLarge;
  }

  squareOff() {
    const sellingPrice = this.stock.lowOfLast(4).low;
    if (this.stock.now().low < sellingPrice) {
      this.exitPosition(sellingPrice);
    }
  }

  sell() {}

  anyZoneTested(today) {
    return (
      this.demandZones.reverse().find((zone) => {
        if (!zone) return false;
        return today.low < zone?.high && today.low > zone?.low;
      }) || null
    );
  }

  buyIfAnyZoneTested = (today) => {
    const zone = this.anyZoneTested(today);

    if (zone && !this.currentTradeInfo?.quantity) {
      const buyingPrice = zone.high;
      const riskForOneStock = buyingPrice - zone.low;
      this.takePosition(riskForOneStock, buyingPrice);
      return;
    }
  };

  addIfNewZoneCreated = (today, prev) => {
    let newZone = null;
    if (this.isProfessionalCandle(today, prev)) {
      newZone = {
        professionalCandle: today,
        high: this.stock.highOfLast(3).high,
        low: this.stock.lowOfLast(3).low,
      };
    }
    this.demandZones.push(newZone);
    this.demandZones = this.demandZones.slice(-20);
  };

  buy() {
    const prev = this.stock.prev();
    const today = this.stock.now();

    // buying if any zone has been tested
    this.buyIfAnyZoneTested(today);

    // checking and adding new demand zones
    this.addIfNewZoneCreated(today, prev);
  }
}

export default PriceActionStrategy;
