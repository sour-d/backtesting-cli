import fs from 'fs/promises';

export async function storeTradeResults(trades, collatedTrades, capital, initialCapital, totalReturns, maxDrawdown) {
  const totalFees = collatedTrades.reduce((acc, trade) => acc + parseFloat(trade.fees), 0).toFixed(2);
  const outputData = {
    trades,
    finalCapital: capital,
    totalReturns,
    maxDrawdown,
    totalFees,
    timestamp: new Date().toISOString(),
    readableTime: new Date().toLocaleString()
  };
  const collatedData = {
    collatedTrades,
    totalFees,
    timestamp: new Date().toISOString(),
    readableTime: new Date().toLocaleString()
  };
  await fs.writeFile('trades.json', JSON.stringify(outputData, null, 2));
  await fs.writeFile('collatedTrades.json', JSON.stringify(collatedData, null, 2));
  console.log(`Total fees incurred: ${totalFees}`);
}
