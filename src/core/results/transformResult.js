import _ from "lodash";
import dayjs from "dayjs";

const trimToTwoDecimal = (value) => {
  if (typeof value === "string" || typeof value === "object") return value;
  return +value.toFixed(2);
};

/**
 * Format a price preserving meaningful precision while cleaning up
 * floating-point noise (e.g. 136.47640000000002 -> 136.4764).
 * Uses 10 significant figures which is sufficient for all financial instruments.
 */
const formatPrice = (price) => {
  if (typeof price !== "number" || isNaN(price)) return price;
  return +price.toPrecision(10);
};

/**
 * Convert a timeFrame value (from config/exchange) to its duration in minutes.
 * Handles both numeric strings ("240", "60") and letter codes ("D", "W", "M").
 */
const getTimeFrameMinutes = (timeFrame) => {
  if (timeFrame == null) return 1;
  const str = String(timeFrame).trim();

  // Numeric string → already in minutes (e.g. "240" = 4h, "60" = 1h)
  const asNumber = Number(str);
  if (!isNaN(asNumber) && asNumber > 0) return asNumber;

  // Letter codes
  switch (str.toUpperCase()) {
    case 'M': return 1;
    case 'H': return 60;
    case 'D': return 1440;
    case 'W': return 10080;
    default: return 1;
  }
};

/**
 * Calculate trade duration in candles.
 * Uses unix timestamps (dateUnix) for accuracy, falling back to date+time strings.
 */
const calculateDuration = (trade, timeFrame) => {
  // Prefer precise unix timestamps when available
  const startUnix = trade.transactionDate?.dateUnix;
  const endUnix = trade.exitDate?.dateUnix;

  let minutesDiff;
  if (startUnix && endUnix) {
    minutesDiff = (endUnix - startUnix) / 60000;
  } else {
    // Fallback: combine date + time for full datetime parsing
    const startDate = trade.transactionDate;
    const endDate = trade.exitDate;
    const startRaw = startDate?.dateUnix
      ? null
      : (startDate?.date && startDate?.time)
        ? `${startDate.date} ${startDate.time}`
        : (startDate?.date ?? startDate);
    const endRaw = endDate?.dateUnix
      ? null
      : (endDate?.date && endDate?.time)
        ? `${endDate.date} ${endDate.time}`
        : (endDate?.date ?? endDate);

    if (!startRaw || !endRaw) return null;
    const startTime = dayjs(startRaw);
    const endTime = dayjs(endRaw);
    if (!startTime.isValid() || !endTime.isValid()) return null;
    minutesDiff = endTime.diff(startTime, 'minute');
  }

  const candleMinutes = getTimeFrameMinutes(timeFrame);
  return Math.max(1, Math.round(minutesDiff / candleMinutes));
};

const calculateDrawdown = (trades) => {
  let runningPnL = 0;
  let peakPnL = 0;
  let currentDrawdown = 0;
  let maxDrawdown = 0;
  let drawdownStart = null;
  let currentDrawdownDuration = 0;
  let maxDrawdownDuration = 0;

  trades.forEach((trade) => {
    runningPnL += trade.profitOrLoss;
    
    if (runningPnL > peakPnL) {
      peakPnL = runningPnL;
      drawdownStart = null;
      currentDrawdownDuration = 0;
      currentDrawdown = 0;
    } else {
      currentDrawdown = peakPnL - runningPnL;
      
      if (!drawdownStart) {
        drawdownStart = trade.transactionDate;
      }
      
      if (drawdownStart) {
        currentDrawdownDuration++;
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
          maxDrawdownDuration = currentDrawdownDuration;
        }
      }
    }

    trade.drawDown = -currentDrawdown; // Negative to indicate loss
    trade.drawDownDuration = currentDrawdownDuration;
  });

  return trades;
};

const calculateReward = (profitOrLoss, risk) => {
  return risk !== 0 ? trimToTwoDecimal(profitOrLoss / Math.abs(risk)) : 0;
};

const calculateFee = (price, quantity) => {
  // Standard fee calculation (0.1% of position value)
  const feePercentage = 0.001;
  return trimToTwoDecimal(Math.abs(quantity * price * feePercentage));
};

const aggregateLog = (trades) => {
  const result = [];
  // Track open positions per symbol (multi-instrument support)
  const openPositions = new Map();

  trades.forEach((trade) => {
    const symbol = trade.symbol || "unknown";
    const fee = calculateFee(trade.price, trade.quantity);

    if (trade.transactionType === "Buy" || trade.transactionType === "Sell") {
      if (trade.risk === 0) return;

      const currentPosition = openPositions.get(symbol);

      if (currentPosition) {
        // Close existing position for this symbol
        currentPosition.exitDate = trade.transactionDate;
        currentPosition.exitPrice = trade.price;
        currentPosition.exitFee = fee;
        result.push(currentPosition);
        openPositions.delete(symbol);
      } else {
        // Open new position for this symbol
        openPositions.set(symbol, {
          symbol,
          transactionDate: trade.transactionDate,
          entryPrice: trade.price,
          quantity: trade.quantity,
          risk: trade.risk,
          type: trade.transactionType === "Buy" ? "Long" : "Short",
          entryFee: fee,
        });
      }
    }

    if (trade.transactionType === "square-off") {
      const currentPosition = openPositions.get(symbol);
      if (currentPosition) {
        currentPosition.exitDate = trade.transactionDate;
        currentPosition.exitPrice = trade.price;
        currentPosition.exitFee = fee;
        result.push(currentPosition);
        openPositions.delete(symbol);
      }
    }
  });

  return result;
};

export { aggregateLog };

export const transformTradesData = (trades, capital, timeFrame) => {
  const aggregatedLog = aggregateLog(trades);
  
  const transformedData = aggregatedLog.map((trade, i) => {
    const profitOrLoss = trade.type === "Long" 
      ? (trade.exitPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - trade.exitPrice) * trade.quantity;

    const totalFee = trade.entryFee + trade.exitFee;
    const profitOrLossAfterFee = trimToTwoDecimal(profitOrLoss - totalFee);

    return {
      id: i + 1,
      type: trade.type,
      symbol: trade.symbol,
      duration: calculateDuration({
        transactionDate: trade.transactionDate,
        exitDate: trade.exitDate
      }, timeFrame),
      profitOrLoss: trimToTwoDecimal(profitOrLoss),
      profitOrLossAfterFee,
      fee: trimToTwoDecimal(totalFee),
      risk: trimToTwoDecimal(trade.risk),
      riskForOneStock: trimToTwoDecimal(trade.risk / trade.quantity),
      reward: calculateReward(profitOrLoss, trade.risk),
      transactionAmount: trimToTwoDecimal(trade.quantity * trade.entryPrice),
      result: profitOrLoss > 0 ? "Profit" : "Loss",
      quantity: trade.quantity,
      transactionDate: trade.transactionDate,
      exitDate: trade.exitDate,
      entryPrice: formatPrice(trade.entryPrice),
      exitPrice: formatPrice(trade.exitPrice)
    };
  });

  // Calculate running totals and equity curve
  let runningPnL = 0;
  let runningReward = 0;
  let currentCapital = capital;
  let peakCapital = capital;

  transformedData.forEach(trade => {
    runningPnL = trimToTwoDecimal(runningPnL + trade.profitOrLoss);
    runningReward = trimToTwoDecimal(runningReward + trade.reward);
    currentCapital = trimToTwoDecimal(currentCapital + trade.profitOrLoss);
    peakCapital = Math.max(peakCapital, currentCapital);

    trade.totalProfitOrLoss = runningPnL;
    trade.totalReward = runningReward;
    trade.currentCapital = currentCapital;
    trade.highestCapital = peakCapital;
  });

  // Calculate drawdowns
  calculateDrawdown(transformedData);

  return transformedData;
};
