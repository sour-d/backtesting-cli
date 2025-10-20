import _ from "lodash";
import { movingAverageOf } from "./nDayMA.js";
import calculateCandleProperty from "./candleStick.js";
import calculateSuperTrendForQuote from "./superTrend.js";
import calculateATR from "./atr.js";
import calculateBollingerBands from "./bollingerBands.js";
import calculateVolumeOscillator from "./volumeOscillator.js";
import calculateAwesomeOscillator from "./awesomeOscillator.js";

const fixTwoDecimal = (obj) => {
  const result = {};
  Object.entries(obj).forEach(([key, value]) => {
    result[key] = +value.toFixed(2);
  });
  return result;
};

const Indicators = (quote, technicalQuotes) => {
  calculateCandleProperty(quote);
  movingAverageOf(quote, technicalQuotes, 20, "high");
  movingAverageOf(quote, technicalQuotes, 20, "low");
  movingAverageOf(quote, technicalQuotes, 200, "close");
  movingAverageOf(quote, technicalQuotes, 60, "close");

  calculateATR(quote, technicalQuotes, 10);
  calculateSuperTrendForQuote(quote, technicalQuotes, 2);

  calculateBollingerBands(quote, technicalQuotes, 20, 2, "close");

  // calculateVolumeOscillator(quote, technicalQuotes, 14, 28);

  // calculateAwesomeOscillator(quote, technicalQuotes, 5, 34);

  return quote;
};

export const addIndicator =
  (indicatorFn, ...extraArgs) =>
    (quote, technicalQuotes) =>
      indicatorFn(quote, technicalQuotes, ...extraArgs);

export default Indicators;
