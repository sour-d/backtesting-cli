import _ from "lodash";

// const isBigAndSmallPattern = (big, small) => {
//   if (
//     Math.abs(small.body) * 3 < Math.abs(big.body) &&
//     small.open < big.high &&
//     small.close > big.high &&
//     small.open > big.low &&
//     small.close < big.close
//   )
//     return true;
// };
const isOppositePattern = (big, small) => {
  if ((small.body > 0 && big.body > 0) || (small.body < 0 && big.body < 0)) {
    return false;
  }
  return true;
};
const isMotherAndChildPattern = (mother, child) => {
  return mother.high > child.high && mother.low < child.low;
};

const volatilityCompression = (currentQuote, prevQuotes, period = 10) => {
  if (prevQuotes.length === 0) return;
  const lastDay = _.last(prevQuotes);
  const beforeLastDay = prevQuotes[prevQuotes.length - 2];

  if (lastDay.volatilityCompressionPresent) {
    const mother = lastDay.volatilityCompressionRange;

    if (isMotherAndChildPattern(mother, currentQuote)) {
      currentQuote.volatilityCompressionPresent = true;
      currentQuote.volatilityCompressionRange = mother;
      return;
    }

    // still didn't break
    if (currentQuote.close < mother.high && currentQuote.close > mother.low) {
      currentQuote.volatilityCompressionPresent = true;
      currentQuote.volatilityCompressionRange = mother;
      return;
    }
  }
  if (isMotherAndChildPattern(lastDay, currentQuote)) {
    // const volumeChange =
    //   (lastDay?.volume - beforeLastDay?.volume) / beforeLastDay?.volume;
    const volumeChange =
      (currentQuote.volume - lastDay.volume) / lastDay.volume;
    currentQuote.volatilityCompressionPresent = true;
    currentQuote.volatilityCompressionRange = {
      high: lastDay.high,
      low: lastDay.low,
      volumeChange: volumeChange,
      isOppositePattern: isOppositePattern(lastDay, currentQuote),
    };
    return;
  }
};

export default volatilityCompression;