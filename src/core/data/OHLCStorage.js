export class ExistingOHLCStorage {
  ohlc;
  currentOHLCIndex;
  name;

  constructor(ohlc, startingIndex = 1, instrumentName = "") {
    this.ohlc = ohlc;
    this.currentOHLCIndex = startingIndex - 1;
    this.name = instrumentName;
  }

  hasData() {
    return this.ohlc.length - 1 > this.currentOHLCIndex;
  }

  now() {
    return this.ohlc[this.currentOHLCIndex];
  }

  prev(quoteCount = 1) {
    return this.ohlc[this.currentOHLCIndex - quoteCount];
  }

  move() {
    if (this.hasData()) {
      this.currentOHLCIndex++;
      return this.now();
    }
  }

  dataOfLast(days) {
    let data = this.ohlc.slice(0, this.currentOHLCIndex);

    if (days < this.currentOHLCIndex) {
      data = this.ohlc.slice(0, this.currentOHLCIndex).slice(-days);
    }

    return new ExistingOHLCStorage(data);
  }

  highOfLast(days) {
    const stock = this.dataOfLast(days);

    let highestDay = stock.now();
    while (stock.move()) {
      if (stock.now().high > highestDay.high) {
        highestDay = stock.now();
      }
    }

    return highestDay;
  }

  lowOfLast(days) {
    const stock = this.dataOfLast(days);

    let lowestDay = stock.now();
    while (stock.move()) {
      if (stock.now().low < lowestDay.low) {
        lowestDay = stock.now();
      }
    }

    return lowestDay;
  }

  simpleMovingAverage(days, key = "close") {
    const stock = this.dataOfLast(days);

    let sumOfDayCloses = this.now()[key];
    while (stock.move()) {
      sumOfDayCloses += stock.now()[key];
    }
    return sumOfDayCloses / days;
  }
}
