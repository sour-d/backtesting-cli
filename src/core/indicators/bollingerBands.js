import _ from "lodash";

const calculateBollingerBands = (quote, prevQuotes, period = 20, multiplier = 2, source = "close") => {
  // Get the last 'period' quotes including current quote for SMA calculation
  const recentQuotes = [...prevQuotes.slice(-(period - 1)), quote];

  // Calculate Simple Moving Average (SMA)
  const sma = _.meanBy(recentQuotes, source);

  // Calculate standard deviation
  const variance = _.meanBy(recentQuotes, (q) => Math.pow(q[source] - sma, 2));
  const standardDeviation = Math.sqrt(variance);

  // Calculate Bollinger Bands
  const upperBand = sma + (multiplier * standardDeviation);
  const lowerBand = sma - (multiplier * standardDeviation);
  const middleBand = sma; // Middle band is the SMA

  // Assign calculated values to the quote
  quote.bbUpper = upperBand;
  quote.bbLower = lowerBand;
  quote.bbMiddle = middleBand;
  quote.bbWidth = upperBand - lowerBand;

  // Calculate %B (Bollinger Band percentage)
  // %B indicates where the price is relative to the bands
  // %B = (Price - Lower Band) / (Upper Band - Lower Band)
  if (upperBand !== lowerBand) {
    quote.bbPercentB = (quote[source] - lowerBand) / (upperBand - lowerBand);
  } else {
    quote.bbPercentB = 0.5; // Default to middle when bands are identical
  }

  // Calculate position relative to bands
  if (quote[source] > upperBand) {
    quote.bbPosition = "Above Upper";
  } else if (quote[source] < lowerBand) {
    quote.bbPosition = "Below Lower";
  } else {
    quote.bbPosition = "Within Bands";
  }
};

export default calculateBollingerBands;