import _ from "lodash";
import dayjs from "dayjs";

const trimToTwoDecimal = (value) => {
  if (typeof value === "string" || typeof value === "object") return value;
  return +value.toFixed(2);
};

const getTimeMultiplier = (timeFrame) => {
  switch (timeFrame.toUpperCase()) {
    case 'M': return 1;
    case 'H': return 60;
    case 'D': return 1440;
    case 'W': return 10080;
    default: return 1;
  }
};

const calculateDuration = (trade, timeFrame) => {
  const startTime = dayjs(trade.transactionDate);
  const endTime = dayjs(trade.exitDate);
  const minutesDiff = endTime.diff(startTime, 'minute');
  const multiplier = getTimeMultiplier(timeFrame);
  return Math.ceil(minutesDiff / multiplier);
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
  let currentPosition = null;

  trades.forEach((trade) => {
    const fee = calculateFee(trade.price, trade.quantity);

    if (trade.transactionType === "Buy" || trade.transactionType === "Sell") {
      if (trade.risk === 0) return;

      if (currentPosition) {
        currentPosition.exitDate = trade.transactionDate;
        currentPosition.exitPrice = trade.price;
        currentPosition.exitFee = fee;
        result.push(currentPosition);
        currentPosition = null;
      } else {
        currentPosition = {
          transactionDate: trade.transactionDate,
          entryPrice: trade.price,
          quantity: trade.quantity,
          risk: trade.risk,
          type: trade.transactionType === "Buy" ? "Long" : "Short",
          entryFee: fee
        };
      }
    }

    if (trade.transactionType === "square-off" && currentPosition) {
      currentPosition.exitDate = trade.transactionDate;
      currentPosition.exitPrice = trade.price;
      currentPosition.exitFee = fee;
      result.push(currentPosition);
      currentPosition = null;
    }
  });

  return result;
};

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
      entryPrice: trimToTwoDecimal(trade.entryPrice),
      exitPrice: trimToTwoDecimal(trade.exitPrice)
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
