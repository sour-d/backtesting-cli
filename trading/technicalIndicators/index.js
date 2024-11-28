import _ from "lodash";
import { highOfLast } from "./nDaysHigh.js";
import { lowOfLast } from "./nDaysLow.js";
import { movingAverageOf } from "./nDayMA.js";
import calculateCandleProperty from "./candleStick.js";
import calculateSuperTrendForQuote from "./superTrend.js";
import calculateATR from "./atr.js";
import { highLow } from "./HighLow.js";
import volatilityCompression from "./volatilityCompression.js";
import { emaOf } from "./nDayEMA.js";
import { bbOf } from "./bb.js";

const fixTwoDecimal = (obj) => {
  const result = {};
  Object.entries(obj).forEach(([key, value]) => {
    result[key] = +value.toFixed(2);
  });
  return result;
};

const Indicators = (quote, technicalQuotes) => {
  calculateCandleProperty(quote);
  emaOf(quote, technicalQuotes, 9, "close");
  bbOf(quote, technicalQuotes, 20, "close");

  return quote;
};

export default Indicators;
