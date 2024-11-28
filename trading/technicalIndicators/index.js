import _ from "lodash";
import { highOfLast } from "./nDaysHigh.js";
import { lowOfLast } from "./nDaysLow.js";
import { movingAverageOf } from "./nDayMA.js";
import calculateCandleProperty from "./candleStick.js";
import calculateSuperTrendForQuote from "./superTrend.js";
import calculateATR from "./atr.js";
import volatilityCompression from "./volatilityCompression.js";
import { highLow } from "./highLow.js";

const fixTwoDecimal = (obj) => {
  const result = {};
  Object.entries(obj).forEach(([key, value]) => {
    result[key] = +value.toFixed(2);
  });
  return result;
};

const Indicators = (quote, technicalQuotes) => {
  calculateCandleProperty(quote);
  movingAverageOf(quote, technicalQuotes, 20, "close");
  // movingAverageOf(quote, technicalQuotes, 20, "low");
  // movingAverageOf(quote, technicalQuotes, 200, "close");
  // movingAverageOf(quote, technicalQuotes, 100, "close");
  // movingAverageOf(quote, technicalQuotes, 50, "close");
  // movingAverageOf(quote, technicalQuotes, 10, "close");

  // calculateATR(quote, technicalQuotes, 10);
  // calculateSuperTrendForQuote(quote, technicalQuotes, 2);

  // movingAverageOf(quote, technicalQuotes, 5, "close");
  // highLow(quote, technicalQuotes);
  return quote;
};

export default Indicators;
