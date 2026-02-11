import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import _ from 'lodash';

dayjs.extend(utc);
dayjs.extend(timezone);

// Symbol list (same as backtest config)
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT',
  'XRPUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT', 'LTCUSDT'
];

// Feature names (order matters for CSV)
const FEATURE_NAMES = [
  'rsi_mean', 'rsi_std',
  'ema_spread_pct_mean', 'ema_spread_pct_std',
  'price_vs_sma50_mean', 'price_vs_sma50_std',
  'price_vs_sma200_mean', 'price_vs_sma200_std',
  'atr_pct_mean', 'atr_pct_std',
  'bollinger_width_pct_mean', 'bollinger_width_pct_std',
  'volume_zscore_mean', 'volume_zscore_std',
  'pct_above_sma50'
  // super_trend_buy_ratio not implemented yet
];

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const CONFIG = {
  // Date range
  startDate: '2020-01-01',
  endDate: '2025-12-31',
  // Prediction frequency: 'weekly' (every Monday) or 'monthly' (1st of month)
  frequency: 'weekly',
  // Forward horizon (bars) for computing strategy returns
  forwardBars: 20,
  // Lookback window (bars) for feature calculation
  lookbackBars: 50,
  // Market data dir (relative to project root)
  marketDataDir: '.data/market',
  // Equity curve CSVs (produced by backtest runs)
  equityCurveMA: 'equity_ma_2020_2025.csv',
  equityCurveBTC: 'equity_btc_2020_2025.csv',
  // Output files (will be written in this folder)
  outputDir: '.',
};

// ----------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------
function loadCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const obj = {};
    headers.forEach((h, idx) => obj[h.trim()] = cols[idx] ? cols[idx].trim() : '');
    data.push(obj);
  }
  return data;
}

function loadOHLCForSymbol(symbol) {
  const filePath = path.resolve(CONFIG.marketDataDir, `${symbol}_240.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Map by date for quick lookup
  const byDate = {};
  raw.forEach(bar => {
    byDate[bar.date] = {
      date: bar.date,
      open: parseFloat(bar.open),
      high: parseFloat(bar.high),
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: parseFloat(bar.volume),
    };
  });
  return byDate;
}

// Simple technical calculations (no need for full indicator set)
function computeRSI(closePrices, period = 14) {
  if (closePrices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < closePrices.length; i++) {
    changes.push(closePrices[i] - closePrices[i - 1]);
  }
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  const avgGain = _.mean(gains.slice(-period));
  const avgLoss = _.mean(losses.slice(-period));
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeEMA(closePrices, period) {
  if (closePrices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = _.mean(closePrices.slice(0, period));
  for (let i = period; i < closePrices.length; i++) {
    ema = (closePrices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function computeSMA(closePrices, period) {
  if (closePrices.length < period) return null;
  return _.mean(closePrices.slice(-period));
}

function computeBollingerWidth(closePrices, period = 20, multiplier = 2) {
  if (closePrices.length < period) return null;
  const sma = _.mean(closePrices.slice(-period));
  const squaredDiffs = closePrices.slice(-period).map(p => Math.pow(p - sma, 2));
  const variance = _.mean(squaredDiffs);
  const std = Math.sqrt(variance);
  const width = (multiplier * std) / sma; // normalized width
  return width;
}

function computeATR(ohlcArr, period = 14) {
  if (ohlcArr.length < period + 1) return null;
  const trValues = [];
  for (let i = 1; i < ohlcArr.length; i++) {
    const prev = ohlcArr[i - 1];
    const cur = ohlcArr[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trValues.push(tr);
  }
  // compute ATR as average of last `period` TRs
  const recent = trValues.slice(-period);
  return _.mean(recent);
}

// ----------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------
async function main() {
  console.log('Generating ML dataset...');

  // Load equity curves
  const equityMA = loadCSV(path.resolve(CONFIG.equityCurveMA));
  const equityBTC = loadCSV(path.resolve(CONFIG.equityCurveBTC));

  // Map equity by date
  const equityByDateMA = {};
  equityMA.forEach(row => {
    equityByDateMA[row.date] = parseFloat(row.total_equity);
  });
  const equityByDateBTC = {};
  equityBTC.forEach(row => {
    equityByDateBTC[row.date] = parseFloat(row.total_equity);
  });

  // Verify date alignment
  const allDates = [...new Set([...Object.keys(equityByDateMA), ...Object.keys(equityByDateBTC)])].sort();
  console.log(`Equity date range: ${allDates[0]} to ${allDates[allDates.length-1]}`);
  console.log(`Total equity bars: ${allDates.length}`);

  // Load OHLC data for all symbols (we need features based on market data)
  const symbolOHLC = {};
  const missingSymbols = [];
  for (const symbol of SYMBOLS) {
    const ohlc = loadOHLCForSymbol(symbol);
    if (!ohlc) {
      missingSymbols.push(symbol);
    } else {
      symbolOHLC[symbol] = ohlc;
    }
  }
  if (missingSymbols.length > 0) {
    console.warn(`Missing OHLC for symbols: ${missingSymbols.join(', ')}`);
  }

  // Determine prediction dates based on frequency
  const startD = dayjs(CONFIG.startDate);
  const endD = dayjs(CONFIG.endDate);
  let predDates = [];
  if (CONFIG.frequency === 'weekly') {
    // Every Monday (or the first day of the week) within range
    let cur = startD.startOf('week');
    while (cur.isBefore(endD) || cur.isSame(endD)) {
      predDates.push(cur.format('YYYY-MM-DD'));
      cur = cur.add(1, 'week');
    }
  } else if (CONFIG.frequency === 'monthly') {
    let cur = startD.startOf('month');
    while (cur.isBefore(endD) || cur.isSame(endD)) {
      predDates.push(cur.format('YYYY-MM-DD'));
      cur = cur.add(1, 'month');
    }
  } else {
    throw new Error('Unknown frequency');
  }

  console.log(`Number of prediction dates: ${predDates.length}`);

  // Build feature vectors and labels
  const features = [];
  const labels = [];
  const featureNames = FEATURE_NAMES;

  for (const predDate of predDates) {
    // Lookback window: from predDate - lookbackBars to predDate - 1
    const dateObj = dayjs(predDate);
    // Get the list of dates that are in the lookback window; we need OHLC data for those dates.
    // Since we have OHLC keyed by date, we can just take the last N dates available for each symbol up to predDate.
    // For each symbol, get an array of close prices, high, low, volume over the lookback period.
    // Then aggregate across symbols.
    let symbolFeatures = [];

    for (const symbol of SYMBOLS) {
      const ohlcMap = symbolOHLC[symbol];
      if (!ohlcMap) continue;
      // Find the sequence of bars up to predDate (exclusive). We need a contiguous series.
      // The data might have gaps for some symbols (e.g., SOL in early years). We'll skip if insufficient.
      // Get all dates <= predDate from ohlcMap keys, sorted.
      const dates = Object.keys(ohlcMap).filter(d => d <= predDate).sort();
      if (dates.length < CONFIG.lookbackBars + 1) continue; // need enough history

      const recentDates = dates.slice(-CONFIG.lookbackBars);
      const closes = recentDates.map(d => ohlcMap[d].close);
      const highs = recentDates.map(d => ohlcMap[d].high);
      const lows = recentDates.map(d => ohlcMap[d].low);
      const volumes = recentDates.map(d => ohlcMap[d].volume);

      // Compute per-symbol features
      const rsi = computeRSI(closes, 14) || 50;
      const ema12 = computeEMA(closes, 12) || closes[closes.length-1];
      const ema26 = computeEMA(closes, 26) || closes[closes.length-1];
      const emaSpread = Math.abs(ema12 - ema26) / closes[closes.length-1];
      const sma50 = computeSMA(closes, 50) || closes[closes.length-1];
      const price_vs_sma50 = (closes[closes.length-1] - sma50) / sma50;
      const sma200 = computeSMA(closes, 200) || closes[closes.length-1];
      const price_vs_sma200 = (closes[closes.length-1] - sma200) / sma200;
      const atr = computeATR(recentDates.map(d => ohlcMap[d]), 14) || (_.mean(highs) - _.mean(lows));
      const atr_pct = atr / closes[closes.length-1];
      const bbWidth = computeBollingerWidth(closes, 20, 2) || 0;
      // Volume z-score over lookback
      const volMean = _.mean(volumes);
      let volStd = 0;
      if (volumes.length > 1) {
        const variance = _.mean(volumes.map(v => Math.pow(v - volMean, 2)));
        volStd = Math.sqrt(variance);
      }
      const volZ = volStd > 0 ? (volumes[volumes.length-1] - volMean) / volStd : 0;

      // SuperTrend direction: we would need to compute SuperTrend. For simplicity, skip or use price above/below SMA20 as proxy.
      // For now, we'll skip that feature.

      const symbolFeature = {
        rsi,
        emaSpread,
        price_vs_sma50,
        price_vs_sma200,
        atr_pct,
        bbWidth,
        volZ,
      };
      symbolFeatures.push(symbolFeature);
    }

    if (symbolFeatures.length === 0) {
      // No symbol had enough data; skip
      continue;
    }

    // Aggregate across symbols: mean and std for each metric
    const agg = {};
    const keys = Object.keys(symbolFeatures[0]);
    for (const key of keys) {
      const values = symbolFeatures.map(sf => sf[key]);
      const mean = _.mean(values);
      agg[`${key}_mean`] = mean;
      // Compute standard deviation manually
      if (values.length > 1) {
        const variance = _.mean(values.map(v => Math.pow(v - mean, 2)));
        agg[`${key}_std`] = Math.sqrt(variance);
      } else {
        agg[`${key}_std`] = 0;
      }
    }
    // Additional aggregate features:
    // pct_above_sma50 = fraction of symbols where price > sma50
    agg.pct_above_sma50 = symbolFeatures.filter(sf => sf.price_vs_sma50 > 0).length / symbolFeatures.length;
    // We don't have super_trend_buy_ratio; skip or use emaSpread positive as proxy? skip.

    // Build feature vector in order of FEATURE_NAMES
    const row = { date: predDate };
    for (const name of featureNames) {
      row[name] = agg[name] !== undefined ? agg[name] : 0;
    }
    features.push(row);

    // Determine label based on forward returns
    // Find future equity for MA and BTC at date + forwardBars
    const dateIdx = allDates.indexOf(predDate);
    if (dateIdx === -1 || dateIdx + CONFIG.forwardBars >= allDates.length) {
      // Not enough future data; skip or label as -1?
      labels.push({ date: predDate, label: -1 });
      continue;
    }
    const futureDate = allDates[dateIdx + CONFIG.forwardBars];
    const equityNowMA = equityByDateMA[predDate];
    const equityNowBTC = equityByDateBTC[predDate];
    const equityFutureMA = equityByDateMA[futureDate];
    const equityFutureBTC = equityByDateBTC[futureDate];

    if (equityNowMA === undefined || equityNowBTC === undefined || equityFutureMA === undefined || equityFutureBTC === undefined) {
      labels.push({ date: predDate, label: -1 });
      continue;
    }

    const retMA = (equityFutureMA - equityNowMA) / equityNowMA;
    const retBTC = (equityFutureBTC - equityNowBTC) / equityNowBTC;

    // Simple label: choose strategy with higher forward return
    let label;
    if (retMA > retBTC) label = 0;
    else if (retBTC > retMA) label = 1;
    else label = 2; // tie (rare)
    labels.push({ date: predDate, label });
  }

  // Write CSVs
  const featureCSV = 'date,' + featureNames.join(',') + '\n' +
    features.map(f => `${f.date},${featureNames.map(n => f[n]).join(',')}`).join('\n');
  const labelsCSV = 'date,label\n' + labels.map(l => `${l.date},${l.label}`).join('\n');

  fs.writeFileSync(path.resolve(CONFIG.outputDir, 'features.csv'), featureCSV, 'utf8');
  fs.writeFileSync(path.resolve(CONFIG.outputDir, 'labels.csv'), labelsCSV, 'utf8');

  // Write metadata
  const metadata = {
    featureNames,
    description: {
      rsi_mean: 'Mean RSI across symbols',
      rsi_std: 'Std dev of RSI',
      ema_spread_pct_mean: 'Mean |EMA12-EMA26|/price',
      ema_spread_pct_std: 'Std dev of ema spread',
      price_vs_sma50_mean: 'Mean (close/SMA50 - 1)',
      price_vs_sma50_std: 'Std dev',
      price_vs_sma200_mean: 'Mean (close/SMA200 - 1)',
      price_vs_sma200_std: 'Std dev',
      atr_pct_mean: 'Mean ATR(14)/price',
      atr_pct_std: 'Std dev ATR%',
      bollinger_width_pct_mean: 'Mean Bollinger width (normalized)',
      bollinger_width_pct_std: 'Std dev',
      volume_zscore_mean: 'Mean volume z-score over lookback',
      volume_zscore_std: 'Std dev volume z-score',
      pct_above_sma50: 'Fraction of symbols above SMA50',
      super_trend_buy_ratio: 'Fraction of symbols with SuperTrend = Buy (not implemented)'
    },
    config: CONFIG,
    generated: new Date().toISOString()
  };
  fs.writeFileSync(path.resolve(CONFIG.outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

  console.log(`Dataset written: ${features.length} samples`);
  console.log('Files: features.csv, labels.csv, metadata.json');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
