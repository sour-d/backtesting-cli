import { LinearModel } from './core/model.js';
import { AIDataLoader } from './core/data_loader.js';
import { storeTradeResults } from './storeTradeResults.js';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { printTradeSummary } from './matrix.js';

dotenv.config();
const symbol = process.env.DEFAULT_SYMBOL || 'BTCUSDT';
const interval = process.env.DEFAULT_INTERVAL || 'D';

// Compute normalization parameters based on current data.
// Always recalculate normalization to reflect the data distribution.
function computeNormalization(model, data) {
  const validSamples = data.filter(d => typeof d.price_change === 'number' && typeof d.volatility === 'number');
  let sumPrice = 0, sumVol = 0;
  validSamples.forEach(d => {
    sumPrice += d.price_change;
    sumVol += d.volatility;
  });
  const meanPrice = sumPrice / validSamples.length;
  const meanVol = sumVol / validSamples.length;
  let squaredPrice = 0, squaredVol = 0;
  validSamples.forEach(d => {
    squaredPrice += (d.price_change - meanPrice) ** 2;
    squaredVol += (d.volatility - meanVol) ** 2;
  });
  const stdPrice = Math.sqrt(squaredPrice / validSamples.length) || 1;
  const stdVol = Math.sqrt(squaredVol / validSamples.length) || 1;
  // Update model normalization parameters
  model.featureMean = { price_change: meanPrice, volatility: meanVol };
  model.featureStd = { price_change: stdPrice, volatility: stdVol };
  return { meanPrice, meanVol, stdPrice, stdVol };
}

function processTrading(model, data, norm) {
  const initialCapital = 100;
  const commissionFee = 0.0006; // 0.06% fee per trade (as fraction)
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let position = 0;
  let currentStopLoss = null;
  const trades = [];

  data.forEach((day, i) => {
    if (i < 5) return; // Warmup period
    const normFeature = {
      price_change: (day.price_change - norm.meanPrice) / norm.stdPrice,
      volatility: (day.volatility - norm.meanVol) / norm.stdVol
    };
    const prediction = model.predict(normFeature);
    const price = day.close;

    // Check for stop-loss hit
    if (position > 0 && currentStopLoss !== null && day.close < currentStopLoss) {
      const value = position * day.close;
      const fee = value * commissionFee;
      capital += (value - fee);
      trades.push({
        type: 'SELL',
        date: day.date,
        readableDate: new Date(day.date).toLocaleString(),
        price: day.close,
        quantity: position,
        note: 'Stop-loss triggered',
        amountReceived: value - fee
      });
      position = 0;
      currentStopLoss = null;
      maxCapital = Math.max(maxCapital, capital);
      return;
    }

    // Trading logic with commission fees
    if (prediction > 0.55 && position === 0) {
      const positionSize = Math.min(0.9, Math.abs(prediction - 0.5) * 2);
      const amount = capital * positionSize;
      const fee = amount * commissionFee;
      position = (amount - fee) / price;
      capital -= amount;
      // Set stop-loss at 2% below entry
      currentStopLoss = price * 0.98;
      trades.push({
        type: 'BUY',
        date: day.date,
        readableDate: new Date(day.date).toLocaleString(),
        price: price,
        quantity: position,
        stopLoss: currentStopLoss,
        amountSpent: amount
      });
    } else if (prediction < 0.45 && position > 0) {
      const proceeds = position * price;
      const fee = proceeds * commissionFee;
      capital += (proceeds - fee);
      trades.push({
        type: 'SELL',
        date: day.date,
        readableDate: new Date(day.date).toLocaleString(),
        price: price,
        quantity: position,
        amountReceived: proceeds - fee
      });
      position = 0;
      currentStopLoss = null;
      maxCapital = Math.max(maxCapital, capital);
    }

    // Trailing stop-loss update: adjust stop-loss if price advances.
    if (position > 0) {
      const newStop = price * 0.98;
      if (newStop > currentStopLoss) {
        currentStopLoss = newStop;
      }
    }
  });

  // Close any open position at final price
  if (position > 0) {
    const finalPrice = data[data.length - 1].close;
    const value = position * finalPrice;
    const fee = value * commissionFee;
    capital += (value - fee);
    trades.push({
      type: 'SELL',
      date: data[data.length - 1].date,
      readableDate: new Date(data[data.length - 1].date).toLocaleString(),
      price: finalPrice,
      quantity: position,
      note: 'Final exit',
      amountReceived: value - fee
    });
    position = 0;
    maxCapital = Math.max(maxCapital, capital);
  }

  const totalReturns = ((capital - initialCapital) / initialCapital * 100).toFixed(2);
  const maxDrawdown = (((maxCapital - capital) / maxCapital) * 100).toFixed(2);

  return { trades, initialCapital, capital, totalReturns, maxDrawdown };
}

function collateTrades(trades) {
  const collated = [];
  const commissionFee = 0.0006; // 0.06% fee per trade
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].type === 'BUY' && trades[i + 1] && trades[i + 1].type === 'SELL') {
      const buyEntry = trades[i];
      const sellEntry = trades[i + 1];
      const feeBuy = buyEntry.price * buyEntry.quantity * commissionFee;
      const feeSell = sellEntry.price * buyEntry.quantity * commissionFee;
      const totalFee = feeBuy + feeSell;
      const profitLoss = (sellEntry.price - buyEntry.price) * buyEntry.quantity - totalFee;
      const profitPct = ((sellEntry.price - buyEntry.price) / buyEntry.price) * 100;
      collated.push({
        buyPrice: buyEntry.price,
        sellPrice: sellEntry.price,
        quantity: buyEntry.quantity,
        profitLoss: profitLoss,
        profitPercentage: profitPct,
        fees: totalFee,
        amountSpent: buyEntry.amountSpent,
        amountReceived: sellEntry.amountReceived,
        buyDate: buyEntry.date,
        sellDate: sellEntry.date,
        buyReadableDate: buyEntry.readableDate,
        sellReadableDate: sellEntry.readableDate
      });
      i++; // Skip paired SELL
    }
  }
  return collated;
}

async function runBacktest() {
  const spinner = ora('Running AI backtest').start();
  try {
    const model = new LinearModel();
    const loader = new AIDataLoader(symbol, interval);
    await model.load();
    const processedData = loader.loadRawData().preprocess();

    const normalization = computeNormalization(model, processedData);
    const tradingResults = processTrading(model, processedData, normalization);
    const collatedTrades = collateTrades(tradingResults.trades);

    // Create report object to pass to the reporting function
    const report = {
      initialCapital: tradingResults.initialCapital,
      finalCapital: tradingResults.capital
    };

    await storeTradeResults(tradingResults.trades, collatedTrades, tradingResults.capital, tradingResults.initialCapital, tradingResults.totalReturns, tradingResults.maxDrawdown);

    spinner.succeed('Backtest complete');
    console.log(chalk.dim('----------------------------------------'));
    printTradeSummary(collatedTrades, report);
    console.log(chalk.dim('----------------------------------------'));
  } catch (error) {
    spinner.fail(`Backtest failed: ${error.message}`);
  }
}

runBacktest();
