import type { TradeEntry, AggregatedTrade, PerformanceStats, Side } from '../types/index.js';

export function aggregateTrades(
  entries: readonly TradeEntry[],
  config: { feeRate: number; capital: number; intervalMinutes?: number },
): AggregatedTrade[] {
  const candleMs = (config.intervalMinutes ?? 240) * 60 * 1000;
  const trades: AggregatedTrade[] = [];
  const openEntries: Map<string, TradeEntry> = new Map();
  let runningCapital = config.capital;
  let highestCapital = config.capital;

  for (const entry of entries) {
    if (entry.type === 'ENTRY') {
      openEntries.set(entry.symbol, entry);
      continue;
    }

    const openEntry = openEntries.get(entry.symbol);
    if (!openEntry) continue;
    openEntries.delete(entry.symbol);

    const transactionAmount = openEntry.quantity * openEntry.price + openEntry.quantity * entry.price;
    const fee = transactionAmount * config.feeRate;

    let grossPnL: number;
    if (openEntry.side === 'Sell') {
      grossPnL = openEntry.quantity * (openEntry.price - entry.price);
    } else {
      grossPnL = openEntry.quantity * (entry.price - openEntry.price);
    }

    const netPnL = grossPnL - fee;
    runningCapital += grossPnL;

    if (runningCapital > highestCapital) {
      highestCapital = runningCapital;
    }

    const drawdown = runningCapital - highestCapital;
    const riskAmount = openEntry.risk * openEntry.quantity;
    const rewardRatio = riskAmount > 0 ? grossPnL / riskAmount : 0;

    const durationMs = entry.timestamp - openEntry.timestamp;
    const durationCandles = Math.max(1, Math.round(durationMs / candleMs));

    let drawdownDuration = 0;
    if (drawdown < 0 && trades.length > 0) {
      const lastTrade = trades[trades.length - 1]!;
      drawdownDuration = lastTrade.drawdown < 0 ? lastTrade.drawdownDuration + 1 : 1;
    }

    trades.push({
      id: trades.length + 1,
      symbol: openEntry.symbol,
      side: openEntry.side,
      entryPrice: openEntry.price,
      exitPrice: entry.price,
      quantity: openEntry.quantity,
      entryTime: openEntry.timestamp,
      exitTime: entry.timestamp,
      durationCandles,
      grossPnL: round2(grossPnL),
      fee: round2(fee),
      netPnL: round2(netPnL),
      risk: round2(riskAmount),
      rewardRatio: round2(rewardRatio),
      result: grossPnL >= 0 ? 'Profit' : 'Loss',
      runningCapital: round2(runningCapital),
      drawdown: round2(drawdown),
      drawdownDuration,
    });
  }

  return trades;
}

export function computeStats(trades: readonly AggregatedTrade[]): PerformanceStats {
  if (trades.length === 0) return emptyStats();

  const wins = trades.filter((t) => t.result === 'Profit');
  const losses = trades.filter((t) => t.result === 'Loss');
  const longs = trades.filter((t) => t.side === 'Buy');
  const shorts = trades.filter((t) => t.side === 'Sell');

  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  for (const trade of trades) {
    if (trade.result === 'Profit') {
      currentWinStreak++;
      currentLossStreak = 0;
      maxConsecWins = Math.max(maxConsecWins, currentWinStreak);
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      maxConsecLosses = Math.max(maxConsecLosses, currentLossStreak);
    }
  }

  const rewards = trades.map((t) => t.rewardRatio);
  const winRewards = wins.map((t) => t.rewardRatio);
  const lossRewards = losses.map((t) => t.rewardRatio);

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: round2((wins.length / trades.length) * 100),
    totalPnL: round2(sum(trades.map((t) => t.grossPnL))),
    totalFees: round2(sum(trades.map((t) => t.fee))),
    netPnL: round2(sum(trades.map((t) => t.netPnL))),
    averageReward: round2(mean(rewards)),
    averageWinReward: round2(mean(winRewards)),
    averageLossReward: round2(mean(lossRewards)),
    maxReward: round2(Math.max(...rewards)),
    minReward: round2(Math.min(...rewards)),
    maxDrawdown: round2(Math.min(...trades.map((t) => t.drawdown))),
    maxDrawdownDuration: (() => {
      const minDD = Math.min(...trades.map((t) => t.drawdown));
      const deepest = trades.find((t) => t.drawdown === minDD);
      return deepest ? deepest.drawdownDuration : 0;
    })(),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    averageDurationCandles: round2(mean(trades.map((t) => t.durationCandles))),
    longs: longs.length,
    longsWon: longs.filter((t) => t.result === 'Profit').length,
    shorts: shorts.length,
    shortsWon: shorts.filter((t) => t.result === 'Profit').length,
  };
}

function emptyStats(): PerformanceStats {
  return {
    totalTrades: 0, wins: 0, losses: 0, winRate: 0,
    totalPnL: 0, totalFees: 0, netPnL: 0,
    averageReward: 0, averageWinReward: 0, averageLossReward: 0,
    maxReward: 0, minReward: 0,
    maxDrawdown: 0, maxDrawdownDuration: 0,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    averageDurationCandles: 0,
    longs: 0, longsWon: 0, shorts: 0, shortsWon: 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : sum(arr) / arr.length;
}
