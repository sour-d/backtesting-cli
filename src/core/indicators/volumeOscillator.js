import _ from "lodash";

const calculateVolumeOscillator = (quote, prevQuotes, fastPeriod = 14, slowPeriod = 28) => {
  // Ensure we have enough data for calculation
  if (prevQuotes.length < slowPeriod - 1) {
    // Not enough data, set default values
    quote.voFastMA = 0;
    quote.voSlowMA = 0;
    quote.volumeOscillator = 0;
    quote.voSignal = "Neutral";
    return;
  }

  // Get the recent quotes including current quote for volume MA calculation
  const recentQuotesForFast = [...prevQuotes.slice(-(fastPeriod - 1)), quote];
  const recentQuotesForSlow = [...prevQuotes.slice(-(slowPeriod - 1)), quote];

  // Calculate Fast Volume Moving Average
  const fastVolumeMA = _.meanBy(recentQuotesForFast, 'volume');

  // Calculate Slow Volume Moving Average  
  const slowVolumeMA = _.meanBy(recentQuotesForSlow, 'volume');

  // Calculate Volume Oscillator as percentage difference
  // VO = ((Fast MA - Slow MA) / Slow MA) * 100
  let volumeOscillator = 0;
  if (slowVolumeMA !== 0) {
    volumeOscillator = ((fastVolumeMA - slowVolumeMA) / slowVolumeMA) * 100;
  }

  // Assign calculated values to the quote
  quote.voFastMA = fastVolumeMA;
  quote.voSlowMA = slowVolumeMA;
  quote.volumeOscillator = volumeOscillator;

  // Generate signals based on oscillator value
  if (volumeOscillator > 10) {
    quote.voSignal = "Strong Bullish Volume";
  } else if (volumeOscillator > 2) {
    quote.voSignal = "Bullish Volume";
  } else if (volumeOscillator < -10) {
    quote.voSignal = "Strong Bearish Volume";
  } else if (volumeOscillator < -2) {
    quote.voSignal = "Bearish Volume";
  } else {
    quote.voSignal = "Neutral Volume";
  }

  // Calculate volume trend compared to previous oscillator value
  const lastQuote = prevQuotes.length > 0 ? prevQuotes[prevQuotes.length - 1] : null;
  if (lastQuote && lastQuote.volumeOscillator !== undefined) {
    if (volumeOscillator > lastQuote.volumeOscillator) {
      quote.voTrend = "Increasing";
    } else if (volumeOscillator < lastQuote.volumeOscillator) {
      quote.voTrend = "Decreasing";
    } else {
      quote.voTrend = "Flat";
    }
  } else {
    quote.voTrend = "Initial";
  }

  // Calculate zero line crossovers for additional signals
  if (lastQuote && lastQuote.volumeOscillator !== undefined) {
    if (lastQuote.volumeOscillator <= 0 && volumeOscillator > 0) {
      quote.voCrossover = "Bullish Crossover";
    } else if (lastQuote.volumeOscillator >= 0 && volumeOscillator < 0) {
      quote.voCrossover = "Bearish Crossover";
    } else {
      quote.voCrossover = "No Crossover";
    }
  } else {
    quote.voCrossover = "Initial";
  }
};

export default calculateVolumeOscillator;