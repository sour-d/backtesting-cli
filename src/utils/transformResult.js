import { std } from "mathjs";

const calculateDuration = (trade) => {
  const startTime = new Date(trade.transactionDate);
  const endTime = new Date(trade.exitDate);
  return Math.floor((endTime - startTime) / (1000 * 60)); // Duration in minutes
};

const calculateDrawdown = (trades) => {
  let maxProfit = 0;
  let drawdown = 0;
  let drawdownStart = null;
  let currentDrawdownDuration = 0;
  let maxDrawdownDuration = 0;

  trades.forEach((trade) => {
    const currentProfit = trade.profitOrLoss;
    
    if (currentProfit > maxProfit) {
      maxProfit = currentProfit;
      drawdownStart = null;
      currentDrawdownDuration = 0;
    } else {
      drawdown = maxProfit - currentProfit;
      
      if (!drawdownStart) {
        drawdownStart = new Date(trade.transactionDate);
      }
      
      if (drawdownStart) {
        currentDrawdownDuration = calculateDuration({
          transactionDate: drawdownStart,
          exitDate: trade.exitDate
        });
        maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
      }
    }

    trade.drawDown = drawdown;
    trade.drawDownDuration = currentDrawdownDuration;
  });

  return trades;
};

const calculateReward = (trade, capital) => {
  return (trade.profitOrLoss / capital) * 100;
};

const calculateFee = (trade) => {
  // Example fee calculation (0.1% of position value)
  const feePercentage = 0.001;
  return Math.abs(trade.quantity * trade.price * feePercentage);
};

export const transformTradesData = (trades, capital, timeframe) => {
  const transformedTrades = trades.map((trade) => ({
    ...trade,
    duration: calculateDuration(trade),
    reward: calculateReward(trade, capital),
    fee: calculateFee(trade),
    profitOrLossAfterFee: trade.profitOrLoss - calculateFee(trade)
  }));

  return calculateDrawdown(transformedTrades);
};
