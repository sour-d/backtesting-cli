import _ from "lodash";

const emaOf = (quote, prevQuotes, days, source) => {
  const keyName = `ema${days}${source}`;

  if (prevQuotes.length === 0) {
    quote[keyName] = quote[source];
    return;
  }

  const lastCandleEma = _.last(prevQuotes)?.[keyName] || quote[source];
  const multiplier = 2 / (days + 1);
  quote[keyName] = (quote[source] - lastCandleEma) * multiplier + lastCandleEma;
};

export { emaOf };