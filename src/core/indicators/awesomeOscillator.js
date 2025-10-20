import _ from "lodash";

const calculateAwesomeOscillator = (quote, prevQuotes, fastPeriod = 5, slowPeriod = 34) => {
  // Calculate median price (HL2) for current quote
  const currentMedianPrice = (quote.high + quote.low) / 2;
  quote.medianPrice = currentMedianPrice;

  // Ensure we have enough data for calculation
  if (prevQuotes.length < slowPeriod - 1) {
    // Not enough data, set default values
    quote.aoFastSMA = currentMedianPrice;
    quote.aoSlowSMA = currentMedianPrice;
    quote.awesomeOscillator = 0;
    quote.aoSignal = "Neutral";
    quote.aoColor = "Red";
    return;
  }

  // Get the recent quotes including current quote for SMA calculation
  // Calculate median price for all previous quotes if not already calculated
  const quotesWithMedianPrice = prevQuotes.map(q => {
    if (!q.medianPrice) {
      q.medianPrice = (q.high + q.low) / 2;
    }
    return q;
  });

  const recentQuotesForFast = [...quotesWithMedianPrice.slice(-(fastPeriod - 1)), quote];
  const recentQuotesForSlow = [...quotesWithMedianPrice.slice(-(slowPeriod - 1)), quote];

  // Calculate 5-period SMA of median price
  const fastSMA = _.meanBy(recentQuotesForFast, 'medianPrice');

  // Calculate 34-period SMA of median price
  const slowSMA = _.meanBy(recentQuotesForSlow, 'medianPrice');

  // Calculate Awesome Oscillator
  // AO = 5-period SMA of median price - 34-period SMA of median price
  const awesomeOscillator = fastSMA - slowSMA;

  // Assign calculated values to the quote
  quote.aoFastSMA = fastSMA;
  quote.aoSlowSMA = slowSMA;
  quote.awesomeOscillator = awesomeOscillator;

  // Determine color based on comparison with previous AO value
  const lastQuote = prevQuotes.length > 0 ? prevQuotes[prevQuotes.length - 1] : null;
  if (lastQuote && lastQuote.awesomeOscillator !== undefined) {
    if (awesomeOscillator > lastQuote.awesomeOscillator) {
      quote.aoColor = "Green"; // Increasing momentum
    } else if (awesomeOscillator < lastQuote.awesomeOscillator) {
      quote.aoColor = "Red"; // Decreasing momentum
    } else {
      quote.aoColor = "Gray"; // No change
    }
  } else {
    quote.aoColor = "Gray"; // Initial value
  }

  // Generate signals based on oscillator behavior
  if (awesomeOscillator > 0) {
    if (lastQuote && lastQuote.awesomeOscillator <= 0) {
      quote.aoSignal = "Bullish Crossover"; // Zero line cross up
    } else if (awesomeOscillator > lastQuote?.awesomeOscillator) {
      quote.aoSignal = "Bullish Momentum"; // Increasing above zero
    } else {
      quote.aoSignal = "Bullish Weakening"; // Decreasing but above zero
    }
  } else if (awesomeOscillator < 0) {
    if (lastQuote && lastQuote.awesomeOscillator >= 0) {
      quote.aoSignal = "Bearish Crossover"; // Zero line cross down
    } else if (awesomeOscillator < lastQuote?.awesomeOscillator) {
      quote.aoSignal = "Bearish Momentum"; // Decreasing below zero
    } else {
      quote.aoSignal = "Bearish Weakening"; // Increasing but below zero
    }
  } else {
    quote.aoSignal = "Neutral"; // Exactly at zero
  }

  // Calculate momentum trend
  if (lastQuote && lastQuote.awesomeOscillator !== undefined) {
    const aoChange = awesomeOscillator - lastQuote.awesomeOscillator;
    if (Math.abs(aoChange) < 0.0001) {
      quote.aoTrend = "Flat";
    } else if (aoChange > 0) {
      quote.aoTrend = "Increasing";
    } else {
      quote.aoTrend = "Decreasing";
    }
    quote.aoChange = aoChange;
  } else {
    quote.aoTrend = "Initial";
    quote.aoChange = 0;
  }

  // Detect potential reversal patterns
  if (prevQuotes.length >= 3) {
    const prev2 = prevQuotes[prevQuotes.length - 3];
    const prev1 = prevQuotes[prevQuotes.length - 2];
    const current = quote;

    // Twin Peaks pattern (bearish reversal)
    if (prev2.awesomeOscillator > 0 && prev1.awesomeOscillator > 0 && current.awesomeOscillator > 0 &&
      prev1.awesomeOscillator < prev2.awesomeOscillator &&
      current.awesomeOscillator < prev1.awesomeOscillator &&
      current.awesomeOscillator > prev2.awesomeOscillator) {
      quote.aoPattern = "Twin Peaks Bearish";
    }
    // Saucer pattern (bullish reversal)
    else if (prev2.awesomeOscillator < 0 && prev1.awesomeOscillator < 0 && current.awesomeOscillator < 0 &&
      prev1.awesomeOscillator > prev2.awesomeOscillator &&
      current.awesomeOscillator > prev1.awesomeOscillator &&
      current.awesomeOscillator < prev2.awesomeOscillator) {
      quote.aoPattern = "Saucer Bullish";
    } else {
      quote.aoPattern = "No Pattern";
    }
  } else {
    quote.aoPattern = "Insufficient Data";
  }
};

export default calculateAwesomeOscillator;