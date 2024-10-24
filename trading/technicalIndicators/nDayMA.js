import _ from "lodash";

const movingAverageOf = (quote, prevQuotes, days, source) => {
  const keyName = `ma${days}${source}`;
  // const totalMovingAverage = _.sumBy(
  //   prevQuotes.slice(-(days - 1)),
  //   (quote) => quote[source]
  // );
  // quote[keyName] = (totalMovingAverage + quote[source]) / days;
  if (prevQuotes.length === 0) {
    quote[keyName] = quote[source];
    return;
  }
  const lastCandleMa = _.last(prevQuotes)?.[keyName] || 0;
  const totalMovingAverage = lastCandleMa * (days - 1);
  quote[keyName] = (totalMovingAverage + quote[source]) / days;
};

export { movingAverageOf };
