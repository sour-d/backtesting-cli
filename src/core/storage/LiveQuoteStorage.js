import LiveQuoteProvider from "../../services/LiveQuoteProvider.js";
import { calculateTechnical } from "../../utils/restructureData.js";
import { ExistingQuoteStorage } from "./ExistingQuoteStorage.js";

export class LiveQuoteStorage extends ExistingQuoteStorage {
  constructor(
    quotes,
    startingQuoteDay = 1,
    id,
    symbol,
    timeFrame,
    name = ""
  ) {
    super([], startingQuoteDay, name);
    this.currentQuoteIndex = -1;
    this.id = id;
    this.symbol = symbol;
    this.timeFrame = timeFrame;
    this.listeners = [];

    quotes.on("Quote", ({ id, symbol, timeFrame, tick }) => {
      if (symbol !== this.symbol || timeFrame !== this.timeFrame) return;
      const technicalQuote = calculateTechnical(tick, this.quotes);
      this.quotes.push(technicalQuote);
      this.currentQuoteIndex++;

      if (startingQuoteDay > this.currentQuoteIndex) return;

      this.listeners.forEach((listener) => listener());
    });
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }
}
