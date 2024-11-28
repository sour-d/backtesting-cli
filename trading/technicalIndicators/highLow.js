import _ from "lodash";

const highLow = (quote, prevQuotes) => {
  const lastQuote = _.last(prevQuotes);
  const prevLastQuote = prevQuotes[prevQuotes.length - 2];
  quote.dow = {
    movingUp: quote.close - lastQuote?.close > 0,
    movingDown: quote.close - lastQuote?.close < 0,
    lastHighPeak: null,
  };

  if (!lastQuote || !prevLastQuote) return;

  lastQuote.dow.isHighPeak = !!(lastQuote.dow.movingUp && quote.dow.movingDown);

  lastQuote.dow.higherHigh = !!(
    lastQuote.dow.isHighPeak &&
    lastQuote.dow.lastHighPeak?.close > prevLastQuote.dow.lastHighPeak?.close
  );
  lastQuote.dow.lowerHigh = !!(
    lastQuote.dow.isHighPeak &&
    lastQuote.dow.lastHighPeak?.close < prevLastQuote.dow.lastHighPeak?.close
  );

  quote.dow.lastHighPeak = lastQuote.dow.isHighPeak
    ? { ...lastQuote, dow: { ...lastQuote.dow, lastHighPeak: null } }
    : lastQuote.dow.lastHighPeak;
};

export { highLow };
