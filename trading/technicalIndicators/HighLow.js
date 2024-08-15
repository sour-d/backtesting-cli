import _ from "lodash";

const highOfLast = (prevQuotes, days) => {
  return _.maxBy(prevQuotes.slice(-days), "high");
};

const lowOfLast = (prevQuotes, days) => {
  return _.minBy(prevQuotes.slice(-days), "low");
};

const highLow = (quote, prevQuotes, high, low) => {
  const highKeyName = `${high}daysHigh`;
  const lowKeyName = `${low}daysLow`;

  quote[highKeyName] = highOfLast(prevQuotes, high)?.high;
  quote[lowKeyName] = lowOfLast(prevQuotes, low)?.low;
};

export { highLow };
