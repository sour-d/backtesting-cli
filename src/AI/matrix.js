import chalk from 'chalk';

export function printTradeSummary(collatedTrades, report) {
  if (!collatedTrades || collatedTrades.length === 0) {
    console.log(chalk.yellow("No trade data to display."));
    return;
  }
  
  // Table header without buy/sell dates
  console.log(chalk.blue("Trade Summary:"));
  console.log(chalk.blue("--------------------------------------------------------------------------------"));
  console.log(chalk.blue("Buy Price        | Sell Price       | Qty    | Profit   | Profit % | Fees   | Amt Spent | Amt Received"));
  console.log(chalk.blue("--------------------------------------------------------------------------------"));
  
  let totalFees = 0;
  let totalAmountSpent = 0;
  let totalAmountReceived = 0;
  let winTrades = 0;
  let lossTrades = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  
  collatedTrades.forEach(trade => {
    const buyPrice = parseFloat(trade.buyPrice);
    const sellPrice = parseFloat(trade.sellPrice);
    const quantity = parseFloat(trade.quantity);
    const profitLoss = parseFloat(trade.profitLoss);
    const profitPercentage = parseFloat(trade.profitPercentage);
    const fees = parseFloat(trade.fees);
    const amountSpent = parseFloat(trade.amountSpent || 0);
    const amountReceived = parseFloat(trade.amountReceived || 0);
    
    totalFees += fees;
    totalAmountSpent += amountSpent;
    totalAmountReceived += amountReceived;
    
    if (profitLoss > 0) {
      winTrades++;
      currentWinStreak++;
      currentLossStreak = 0;
    } else {
      lossTrades++;
      currentLossStreak++;
      currentWinStreak = 0;
    }
    if (currentWinStreak > maxConsecutiveWins) {
      maxConsecutiveWins = currentWinStreak;
    }
    if (currentLossStreak > maxConsecutiveLosses) {
      maxConsecutiveLosses = currentLossStreak;
    }
    
    const line = `${String(buyPrice.toFixed(8)).padEnd(16)} | ${String(sellPrice.toFixed(8)).padEnd(16)} | ${String(quantity.toFixed(2)).padEnd(6)} | ${String(profitLoss.toFixed(2)).padEnd(8)} | ${String(profitPercentage.toFixed(2)).padEnd(8)} | ${String(fees.toFixed(2)).padEnd(6)} | ${String(amountSpent.toFixed(2)).padEnd(9)} | ${String(amountReceived.toFixed(2)).padEnd(13)}`;
    console.log(chalk.white(line));
  });
  
  console.log(chalk.blue("--------------------------------------------------------------------------------"));
  
  const totalTrades = collatedTrades.length;
  
  console.log(chalk.green(`Total Trades: ${totalTrades}`));
  console.log(chalk.green(`Wins: ${winTrades} | Losses: ${lossTrades}`));
  console.log(chalk.green(`Total Fees: ${totalFees.toFixed(2)}`));
  console.log(chalk.green(`Max Consecutive Wins: ${maxConsecutiveWins} | Max Consecutive Losses: ${maxConsecutiveLosses}`));
  console.log(chalk.blue("--------------------------------------------------------------------------------"));
  
  // Display overall report summary using report object
  console.log(chalk.green(`Amount Started With: ${report.initialCapital.toFixed(2)}`));
  console.log(chalk.green(`Amount Left After Trades: ${report.finalCapital.toFixed(2)}`));
  const overallProfitPct = ((report.finalCapital - report.initialCapital) / report.initialCapital * 100).toFixed(2);
  console.log(chalk.green(`Overall Profit: ${overallProfitPct}%`));
  console.log(chalk.blue("--------------------------------------------------------------------------------"));
}
