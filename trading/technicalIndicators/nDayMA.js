import _ from "lodash";

const movingAverageOf = (quote, prevQuotes, days, source) => {
  const keyName = `ma${days}${source}`;
  // let totalMovingAverage = 0;
  // if (prevQuote) {
  //   const prevMA = prevQuote[keyName];
  //   totalMovingAverage = prevMA * days - prevMA + prevQuote[source];
  // }
  // quote[keyName] = (totalMovingAverage + prevQuote[source]) / days;
  const totalMovingAverage = _.sumBy(
    prevQuotes.slice(-days),
    (quote) => quote[source]
  );
  quote[keyName] = totalMovingAverage / days;
};

export { movingAverageOf };
