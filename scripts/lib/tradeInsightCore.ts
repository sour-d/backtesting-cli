/**
 * Shared trade / round-trip stats (used by tradeInsights.ts + liveApiInsights.ts).
 */
import chalk from 'chalk';

export type Side = 'Buy' | 'Sell';
export type Kind = 'entry' | 'exit';

export interface JsonlRow {
  readonly symbol: string;
  readonly side: Side;
  readonly qty: number;
  readonly price: number;
  readonly fee: number;
  readonly timestamp: number;
  readonly kind: Kind | 'reconcile';
}

export interface RoundTrip {
  readonly symbol: string;
  readonly type: 'Long' | 'Short';
  readonly entryTs: number;
  readonly exitTs: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly qty: number;
  readonly entryFee: number;
  readonly exitFee: number;
  readonly profitOrLoss: number;
  readonly profitOrLossAfterFee: number;
  readonly fee: number;
  readonly durationCandles: number;
  readonly reward: number;
  readonly rewardBasis: 'risk' | 'notional';
}

export function trim2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function intervalStringToMinutes(s: string): number {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  switch (t.toUpperCase()) {
    case 'D':
      return 1440;
    case 'W':
      return 10080;
    case 'M':
      return 43200;
    default:
      return 240;
  }
}

export interface RewardOpts {
  readonly riskPerTrade: number | null;
  readonly capital: number | null;
}

export function rewardLabelFor(opts: RewardOpts): string {
  return opts.riskPerTrade != null
    ? `R = PnL / fixed risk (${opts.riskPerTrade})`
    : opts.capital != null
      ? `R = PnL / (capital×5%) [capital=${opts.capital}]`
      : 'R-like = PnL / entry notional (pass --risk-per-trade or --capital for engine-style R)';
}

export function rowKey(r: JsonlRow): string {
  return `${r.timestamp}|${r.kind}|${r.side}|${r.price}|${r.qty}|${r.fee}`;
}

export function sortAndDedupeRows(
  rows: (JsonlRow & { lineIndex?: number })[],
  dedupe: boolean,
): JsonlRow[] {
  const copy = [...rows];
  copy.sort(
    (a, b) =>
      a.timestamp - b.timestamp || (a.lineIndex ?? 0) - (b.lineIndex ?? 0),
  );
  const sorted = copy.map(({ lineIndex: _, ...rest }) => rest as JsonlRow);
  if (!dedupe) return sorted;
  const seen = new Set<string>();
  const out: JsonlRow[] = [];
  for (const r of sorted) {
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

interface OpenLeg {
  readonly symbol: string;
  readonly type: 'Long' | 'Short';
  readonly entryPrice: number;
  readonly qty: number;
  readonly entryFee: number;
  readonly entryTs: number;
}

export function aggregateRoundTrips(
  rows: JsonlRow[],
  intervalMinutes: number,
  riskPerTrade: number | null,
  capital: number | null,
): RoundTrip[] {
  const msPerCandle = intervalMinutes * 60 * 1000;
  const openBySymbol = new Map<string, OpenLeg>();
  const out: RoundTrip[] = [];

  let defaultRisk: number | null = riskPerTrade;
  if (defaultRisk == null && capital != null) {
    defaultRisk = capital * 0.05;
  }

  for (const r of rows) {
    if (r.kind === 'reconcile') continue;

    if (r.kind === 'entry') {
      const type: 'Long' | 'Short' = r.side === 'Buy' ? 'Long' : 'Short';
      if (openBySymbol.has(r.symbol)) {
        throw new Error(`Entry while already open: ${r.symbol} @ ${r.timestamp}`);
      }
      openBySymbol.set(r.symbol, {
        symbol: r.symbol,
        type,
        entryPrice: r.price,
        qty: r.qty,
        entryFee: r.fee,
        entryTs: r.timestamp,
      });
      continue;
    }

    if (r.kind === 'exit') {
      const open = openBySymbol.get(r.symbol);
      if (!open) {
        throw new Error(`Exit with no open position: ${r.symbol} @ ${r.timestamp}`);
      }
      const expectedExit: Side = open.type === 'Long' ? 'Sell' : 'Buy';
      if (r.side !== expectedExit) {
        throw new Error(`Exit side mismatch for ${r.symbol}: open ${open.type}, got ${r.side}`);
      }

      const gross =
        open.type === 'Long'
          ? (r.price - open.entryPrice) * r.qty
          : (open.entryPrice - r.price) * r.qty;
      const fee = open.entryFee + r.fee;
      const profitOrLoss = trim2(gross);
      const profitOrLossAfterFee = trim2(gross - fee);
      const entryNotional = Math.abs(open.qty * open.entryPrice);
      const rewardBasis: 'risk' | 'notional' =
        defaultRisk != null && defaultRisk > 0 ? 'risk' : 'notional';
      const denom =
        rewardBasis === 'risk' ? defaultRisk! : Math.max(entryNotional, 1e-12);
      const reward = trim2(profitOrLoss / denom);

      const durationMs = Math.max(0, r.timestamp - open.entryTs);
      const durationCandles = Math.max(1, Math.round(durationMs / msPerCandle));

      out.push({
        symbol: r.symbol,
        type: open.type,
        entryTs: open.entryTs,
        exitTs: r.timestamp,
        entryPrice: open.entryPrice,
        exitPrice: r.price,
        qty: r.qty,
        entryFee: open.entryFee,
        exitFee: r.fee,
        profitOrLoss,
        profitOrLossAfterFee,
        fee,
        durationCandles,
        reward,
        rewardBasis,
      });
      openBySymbol.delete(r.symbol);
    }
  }

  for (const [sym] of openBySymbol) {
    console.warn(chalk.yellow(`Warning: open position still on book: ${sym}`));
  }

  return out;
}

function maxConsecutive(trades: RoundTrip[], pred: (t: RoundTrip) => boolean): number {
  let cur = 0;
  let best = 0;
  for (const t of trades) {
    if (pred(t)) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

function drawdownTradeStats(trades: RoundTrip[]): {
  maxDrawDown: number;
  maxDrawDownDuration: number;
} {
  let runningPnL = 0;
  let peakPnL = 0;
  let maxDrawdown = 0;
  let drawdownStart = false;
  let currentDrawdownDuration = 0;
  let maxDrawdownDuration = 0;

  for (const t of trades) {
    runningPnL = trim2(runningPnL + t.profitOrLossAfterFee);
    if (runningPnL > peakPnL) {
      peakPnL = runningPnL;
      drawdownStart = false;
      currentDrawdownDuration = 0;
    } else {
      const currentDrawdown = peakPnL - runningPnL;
      if (!drawdownStart) drawdownStart = true;
      if (drawdownStart) {
        currentDrawdownDuration++;
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
          maxDrawdownDuration = currentDrawdownDuration;
        }
      }
    }
  }

  return {
    maxDrawDown: trim2(-maxDrawdown),
    maxDrawDownDuration: maxDrawdownDuration,
  };
}

export function buildStats(trades: RoundTrip[]) {
  const n = trades.length;
  const eps = 1e-8;
  const wins = trades.filter((t) => t.profitOrLoss > eps);
  const losses = trades.filter((t) => t.profitOrLoss < -eps);
  const breakeven = trades.filter((t) => Math.abs(t.profitOrLoss) <= eps);

  const tradeStats = {
    totalTrades: n,
    win: wins.length,
    loss: losses.length,
    breakeven: breakeven.length,
    accuracy: n > 0 ? trim2((wins.length / n) * 100) : 0,
    maxConsecutiveWins: maxConsecutive(trades, (t) => t.profitOrLoss > eps),
    maxConsecutiveLosses: maxConsecutive(trades, (t) => t.profitOrLoss < -eps),
    shorts: trades.filter((t) => t.type === 'Short').length,
    shortsWon: trades.filter((t) => t.type === 'Short' && t.profitOrLoss > eps).length,
    longs: trades.filter((t) => t.type === 'Long').length,
    longsWon: trades.filter((t) => t.type === 'Long' && t.profitOrLoss > eps).length,
    averageTradeCandle:
      n > 0 ? trim2(trades.reduce((a, t) => a + t.durationCandles, 0) / n) : 0,
  };

  const totalReward = trim2(trades.reduce((a, t) => a + t.reward, 0));
  const rewards = trades.map((t) => t.reward);
  const maxReward = rewards.length ? Math.max(...rewards) : 0;
  const minReward = rewards.length ? Math.min(...rewards) : 0;

  const performance = {
    totalReward,
    maxReward: trim2(maxReward),
    minReward: trim2(minReward),
    averageWinReward:
      wins.length > 0 ? trim2(wins.reduce((a, t) => a + t.reward, 0) / wins.length) : 0,
    averageLossReward:
      losses.length > 0 ? trim2(losses.reduce((a, t) => a + t.reward, 0) / losses.length) : 0,
    averageReward: n > 0 ? trim2(totalReward / n) : 0,
    totalProfitOrLoss: trim2(trades.reduce((a, t) => a + t.profitOrLoss, 0)),
    fee: trim2(trades.reduce((a, t) => a + t.fee, 0)),
    profitOrLossAfterFee: trim2(trades.reduce((a, t) => a + t.profitOrLossAfterFee, 0)),
    ...drawdownTradeStats(trades),
  };

  return { tradeStats, performance };
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function printHuman(
  trade: ReturnType<typeof buildStats>['tradeStats'],
  perf: ReturnType<typeof buildStats>['performance'],
  rewardLabel: string,
): void {
  console.log(chalk.cyan('\nTrading statistics'));
  console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold('Total round-trips: ') + chalk.green(String(trade.totalTrades)));
  console.log(chalk.bold('Winning:           ') + chalk.green(String(trade.win)));
  console.log(chalk.bold('Losing:            ') + chalk.red(String(trade.loss)));
  if (trade.breakeven > 0) {
    console.log(chalk.bold('Breakeven (gross): ') + chalk.yellow(String(trade.breakeven)));
  }
  console.log(chalk.bold('Win rate:          ') + chalk.yellow(trade.accuracy + '%'));
  console.log(chalk.bold('Max consec. wins:   ') + chalk.green(String(trade.maxConsecutiveWins)));
  console.log(chalk.bold('Max consec. losses: ') + chalk.red(String(trade.maxConsecutiveLosses)));

  console.log(chalk.bold('\nDirection'));
  console.log(chalk.bold('Short trades:      ') + chalk.blue(trade.shorts));
  console.log(chalk.bold('Short wins:        ') + chalk.green(trade.shortsWon));
  console.log(chalk.bold('Long trades:       ') + chalk.blue(trade.longs));
  console.log(chalk.bold('Long wins:         ') + chalk.green(trade.longsWon));

  console.log(chalk.bold(`\nReward (${rewardLabel})`));
  console.log(chalk.bold('Total:             ') + chalk.yellow(formatNum(perf.totalReward)));
  console.log(chalk.bold('Best:              ') + chalk.green(formatNum(perf.maxReward)));
  console.log(chalk.bold('Worst:             ') + chalk.red(formatNum(perf.minReward)));
  console.log(chalk.bold('Avg (winners):     ') + chalk.green(formatNum(perf.averageWinReward)));
  console.log(chalk.bold('Avg (losers):      ') + chalk.red(formatNum(perf.averageLossReward)));
  console.log(chalk.bold('Avg per trade:     ') + chalk.yellow(formatNum(perf.averageReward)));

  console.log(chalk.bold('\nP&L'));
  const pnlC = perf.totalProfitOrLoss >= 0 ? chalk.green : chalk.red;
  console.log(chalk.bold('Total (gross):     ') + pnlC(formatNum(perf.totalProfitOrLoss)));
  console.log(chalk.bold('Fees:              ') + chalk.red(formatNum(perf.fee)));
  console.log(chalk.bold('After fees:        ') + pnlC(formatNum(perf.profitOrLossAfterFee)));

  console.log(chalk.bold('\nRisk'));
  console.log(
    chalk.bold('Max drawdown (net): ') + chalk.red(formatNum(Math.abs(perf.maxDrawDown))),
  );
  console.log(
    chalk.bold('DD duration:        ') + chalk.yellow(perf.maxDrawDownDuration + ' trades'),
  );
  console.log(
    chalk.bold('Avg trade length:   ') + chalk.yellow(trade.averageTradeCandle + ' candles'),
  );
  console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}
