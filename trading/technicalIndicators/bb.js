import _ from "lodash";

const bbOf = (quote, prevQuotes, days, source, numStdDev = 2) => {
  const keyNameMiddle = `bbMiddle${days}${source}`;
  const keyNameUpper = `bbUpper${days}${source}`;
  const keyNameLower = `bbLower${days}${source}`;

  if (prevQuotes.length < days - 1) {
    quote[keyNameMiddle] = quote[source];
    quote[keyNameUpper] = quote[source];
    quote[keyNameLower] = quote[source];
    return;
  }

  const relevantQuotes = prevQuotes.slice(-days + 1).map(q => q[source]).concat(quote[source]);
  const mean = _.mean(relevantQuotes);
  const stdDev = Math.sqrt(_.mean(relevantQuotes.map(val => Math.pow(val - mean, 2))));

  quote[keyNameMiddle] = mean;
  quote[keyNameUpper] = mean + numStdDev * stdDev;
  quote[keyNameLower] = mean - numStdDev * stdDev;
};

export { bbOf };