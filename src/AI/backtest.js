import { LinearModel } from './core/model.js';
import { AIDataLoader } from './core/data_loader.js';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
dotenv.config();
const symbol = process.env.DEFAULT_SYMBOL || 'BTCUSDT';
const interval = process.env.DEFAULT_INTERVAL || 'D';

class AIBacktester {
  constructor() {
    this.model = new LinearModel();
    this.loader = new AIDataLoader(symbol, interval);
  }

  async runBacktest() {
    const spinner = ora('Running AI backtest').start();

    try {
      await this.model.load();
      const processedData = this.loader.loadRawData().preprocess();

      // If the loaded model does not have normalization parameters, compute them from the current dataset.
      let meanPrice, meanVol, stdPrice, stdVol;
      if (!this.model.featureMean || !this.model.featureStd) {
        const validSamples = processedData.filter(d => typeof d.price_change === 'number' && typeof d.volatility === 'number');
        let sumPrice = 0, sumVol = 0;
        validSamples.forEach(d => { sumPrice += d.price_change; sumVol += d.volatility; });
        meanPrice = sumPrice / validSamples.length;
        meanVol = sumVol / validSamples.length;
        let squaredPrice = 0, squaredVol = 0;
        validSamples.forEach(d => {
          squaredPrice += (d.price_change - meanPrice) ** 2;
          squaredVol += (d.volatility - meanVol) ** 2;
        });
        stdPrice = Math.sqrt(squaredPrice / validSamples.length) || 1;
        stdVol = Math.sqrt(squaredVol / validSamples.length) || 1;
        // store computed normalization parameters in the model for consistency
        this.model.featureMean = { price_change: meanPrice, volatility: meanVol };
        this.model.featureStd = { price_change: stdPrice, volatility: stdVol };
      } else {
        ({ price_change: meanPrice, volatility: meanVol } = this.model.featureMean);
        ({ price_change: stdPrice, volatility: stdVol } = this.model.featureStd);
      }

      let capital = 100000;
      let position = 0;
      let trades = [];

      processedData.forEach((day, i) => {
        if (i < 5) return; // Warmup period

        const normFeature = {
          price_change: (day.price_change - meanPrice) / stdPrice,
          volatility: (day.volatility - meanVol) / stdVol
        };
        const prediction = this.model.predict(normFeature);
        const price = day.close;

        // Enhanced trading rules with dynamic sizing
        const positionSize = Math.min(0.9, Math.abs(prediction - 0.5) * 2);

        if (prediction > 0.55 && position <= 0) {
          const amount = capital * positionSize;
          position = amount / price;
          capital -= amount;
          trades.push({
            type: 'BUY',
            date: day.date,
            readableDate: new Date(day.date).toLocaleString(),
            price,
            quantity: position
          });
        } else if (prediction < 0.45 && position > 0) {
          const value = position * price;
          capital += value;
          trades.push({
            type: 'SELL',
            date: day.date,
            readableDate: new Date(day.date).toLocaleString(),
            price,
            quantity: position
          });
          position = 0;
        }
      });

      // Close any open position
      if (position > 0) {
        const value = position * processedData[processedData.length - 1].close;
        capital += value;
      }

      const returns = ((capital - 100000) / 100000 * 100).toFixed(1);

      // Store trade data along with final capital, total returns and timestamp
      const fs = await import('fs/promises');
      await fs.writeFile("trades.json", JSON.stringify({
        trades: trades,
        finalCapital: capital,
        totalReturns: returns,
        timestamp: new Date().toISOString(),
        readableTime: new Date().toLocaleString()
      }, null, 2));

      // Collate buy/sell trades into consolidated entries
      const collatedTrades = [];
      for (let i = 0; i < trades.length; i++) {
        if (trades[i].type === "BUY" && trades[i + 1] && trades[i + 1].type === "SELL") {
          const buyEntry = trades[i];
          const sellEntry = trades[i + 1];
          const profitLoss = (sellEntry.price - buyEntry.price) * buyEntry.quantity;
          const profitPct = ((sellEntry.price - buyEntry.price) / buyEntry.price) * 100;
          collatedTrades.push({
            buyDate: buyEntry.date,
            buyReadableDate: buyEntry.readableDate,
            buyPrice: buyEntry.price,
            sellDate: sellEntry.date,
            sellReadableDate: sellEntry.readableDate,
            sellPrice: sellEntry.price,
            quantity: buyEntry.quantity,
            profitLoss: profitLoss,
            profitPercentage: profitPct.toFixed(2)
          });
          i++; // Skip the next trade as it has been processed
        }
      }

      // Write the collated trades log
      await fs.writeFile("collatedTrades.json", JSON.stringify({
        collatedTrades: collatedTrades,
        timestamp: new Date().toISOString(),
        readableTime: new Date().toLocaleString()
      }, null, 2));

      spinner.succeed('Backtest complete');
      console.log(chalk.dim('════════════════════════════════════════'));
      console.log(`${chalk.bold('Starting Capital:')} ${chalk.yellow('$100,000')}`);
      console.log(`${chalk.bold('  Ending Capital:')} ${chalk.green(`$${capital.toFixed(2)}`)}`);
      console.log(`${chalk.bold(' Total Returns:')} ${returns > 0 ? chalk.green(`${returns}%`) : chalk.red(`${returns}%`)}`);
      console.log(`${chalk.bold(' Trade Count:')} ${trades.length}`);
      console.log(chalk.dim('════════════════════════════════════════'));

    } catch (error) {
      spinner.fail(`Backtest failed: ${error.message}`);
    }
  }
}

new AIBacktester().runBacktest();
