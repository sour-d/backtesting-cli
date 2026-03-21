/**
 * Insights from new-repo trade JSONL (same spirit as backtesting-cli-old `results.js` + CLI summary).
 *
 *   npx tsx scripts/tradeInsights.ts
 *   npx tsx scripts/tradeInsights.ts --json > insights.json
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { loadQuantlabConfig } from "../src/config/loadConfig.js";

type Side = "Buy" | "Sell";
type Kind = "entry" | "exit";

interface JsonlRow {
  readonly symbol: string;
  readonly side: Side;
  readonly qty: number;
  readonly price: number;
  readonly fee: number;
  readonly timestamp: number;
  readonly kind: Kind | "reconcile";
}

interface RoundTrip {
  readonly symbol: string;
  readonly type: "Long" | "Short";
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
  /** PnL / |risk|; omitted risk → PnL / entry notional (see `rewardBasis`). */
  readonly reward: number;
  readonly rewardBasis: "risk" | "notional";
}

function trim2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map quantlab `interval` (e.g. "240", "D") to minutes for avg trade length. */
function intervalStringToMinutes(s: string): number {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  switch (t.toUpperCase()) {
    case "D":
      return 1440;
    case "W":
      return 10080;
    case "M":
      return 43200;
    default:
      return 240;
  }
}

interface ParsedTradeInsightsOpts {
  readonly path: string;
  readonly intervalMinutes: number;
  readonly dedupe: boolean;
  readonly json: boolean;
  readonly riskPerTrade: number | null;
  readonly capital: number | null;
  readonly allSymbols: boolean;
  readonly configPath: string;
}

function parseArgs(argv: string[]): ParsedTradeInsightsOpts {
  let path = ".data/trades/SOLUSDT.jsonl";
  let intervalMinutes = 240;
  let dedupe = true;
  let json = false;
  let riskPerTrade: number | null = null;
  let capital: number | null = null;
  let allSymbols = false;
  let configPath = "quantlab.config.js";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" && argv[i + 1]) path = argv[++i];
    else if (a === "--interval" && argv[i + 1])
      intervalMinutes = Number(argv[++i]);
    else if (a === "--no-dedupe") dedupe = false;
    else if (a === "--json") json = true;
    else if (a === "--risk-per-trade" && argv[i + 1])
      riskPerTrade = Number(argv[++i]);
    else if (a === "--capital" && argv[i + 1]) capital = Number(argv[++i]);
    else if (a === "--all-symbols") allSymbols = true;
    else if (a === "--config" && argv[i + 1]) configPath = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`tradeInsights — summarize backtest JSONL trades

Defaults align with quantlab.config.js-style 4h bars (interval 240).

Options:
  --path <file>          Trade JSONL (default: .data/trades/SOLUSDT.jsonl)
  --interval <minutes>   Bar length in minutes for avg trade length (default: 240)
  --no-dedupe            Do not drop duplicate identical rows
  --risk-per-trade <n>   Fixed $ risk for PnL / risk (like old engine)
  --capital <n>          With no --risk-per-trade, risk = capital * 5%
  --all-symbols          Run once per symbol in quantlab.config.js (.data/trades/<SYM>.jsonl)
  --config <file>        Quantlab config for --all-symbols (default: quantlab.config.js)
  --json                 Print JSON only (no chalk)
`);
      process.exit(0);
    }
  }

  return {
    path: resolve(path),
    intervalMinutes,
    dedupe,
    json,
    riskPerTrade,
    capital,
    allSymbols,
    configPath: resolve(configPath),
  };
}

function rowKey(r: JsonlRow): string {
  return `${r.timestamp}|${r.kind}|${r.side}|${r.price}|${r.qty}|${r.fee}`;
}

async function loadRows(file: string, dedupe: boolean): Promise<JsonlRow[]> {
  const raw = await readFile(file, "utf8");
  const rows: (JsonlRow & { lineIndex: number })[] = [];
  let lineIndex = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const r = JSON.parse(t) as JsonlRow;
    rows.push({ ...r, lineIndex });
    lineIndex++;
  }
  const withLine = rows;
  withLine.sort(
    (a, b) => a.timestamp - b.timestamp || a.lineIndex - b.lineIndex,
  );
  const sorted = withLine.map(({ lineIndex: _, ...rest }) => rest as JsonlRow);
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
  readonly type: "Long" | "Short";
  readonly entryPrice: number;
  readonly qty: number;
  readonly entryFee: number;
  readonly entryTs: number;
}

function aggregateRoundTrips(
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
    if (r.kind === "reconcile") continue;

    if (r.kind === "entry") {
      const type: "Long" | "Short" = r.side === "Buy" ? "Long" : "Short";
      if (openBySymbol.has(r.symbol)) {
        throw new Error(
          `Entry while already open: ${r.symbol} @ ${r.timestamp}`,
        );
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

    if (r.kind === "exit") {
      const open = openBySymbol.get(r.symbol);
      if (!open) {
        throw new Error(`Exit with no open position: ${r.symbol} @ ${r.timestamp}`);
      }
      const expectedExit: Side = open.type === "Long" ? "Sell" : "Buy";
      if (r.side !== expectedExit) {
        throw new Error(
          `Exit side mismatch for ${r.symbol}: open ${open.type}, got ${r.side}`,
        );
      }

      const gross =
        open.type === "Long"
          ? (r.price - open.entryPrice) * r.qty
          : (open.entryPrice - r.price) * r.qty;
      const fee = open.entryFee + r.fee;
      const profitOrLoss = trim2(gross);
      const profitOrLossAfterFee = trim2(gross - fee);
      const entryNotional = Math.abs(open.qty * open.entryPrice);
      const rewardBasis: "risk" | "notional" =
        defaultRisk != null && defaultRisk > 0 ? "risk" : "notional";
      const denom =
        rewardBasis === "risk" ? defaultRisk! : Math.max(entryNotional, 1e-12);
      const reward = trim2(profitOrLoss / denom);

      const durationMs = Math.max(0, r.timestamp - open.entryTs);
      const durationCandles = Math.max(
        1,
        Math.round(durationMs / msPerCandle),
      );

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

function maxConsecutive(
  trades: RoundTrip[],
  pred: (t: RoundTrip) => boolean,
): number {
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

/** Mirrors backtesting-cli-old `calculateDrawdown` + performance max drawdown. */
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

function buildStats(trades: RoundTrip[]) {
  const n = trades.length;
  const eps = 1e-8;
  const wins = trades.filter((t) => t.profitOrLoss > eps);
  const losses = trades.filter((t) => t.profitOrLoss < -eps);
  const breakeven = trades.filter(
    (t) => Math.abs(t.profitOrLoss) <= eps,
  );

  const tradeStats = {
    totalTrades: n,
    win: wins.length,
    loss: losses.length,
    breakeven: breakeven.length,
    accuracy: n > 0 ? trim2((wins.length / n) * 100) : 0,
    maxConsecutiveWins: maxConsecutive(trades, (t) => t.profitOrLoss > eps),
    maxConsecutiveLosses: maxConsecutive(trades, (t) => t.profitOrLoss < -eps),
    shorts: trades.filter((t) => t.type === "Short").length,
    shortsWon: trades.filter(
      (t) => t.type === "Short" && t.profitOrLoss > eps,
    ).length,
    longs: trades.filter((t) => t.type === "Long").length,
    longsWon: trades.filter((t) => t.type === "Long" && t.profitOrLoss > eps)
      .length,
    averageTradeCandle:
      n > 0
        ? trim2(
            trades.reduce((a, t) => a + t.durationCandles, 0) / n,
          )
        : 0,
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
      wins.length > 0
        ? trim2(wins.reduce((a, t) => a + t.reward, 0) / wins.length)
        : 0,
    averageLossReward:
      losses.length > 0
        ? trim2(losses.reduce((a, t) => a + t.reward, 0) / losses.length)
        : 0,
    averageReward: n > 0 ? trim2(totalReward / n) : 0,
    totalProfitOrLoss: trim2(trades.reduce((a, t) => a + t.profitOrLoss, 0)),
    fee: trim2(trades.reduce((a, t) => a + t.fee, 0)),
    profitOrLossAfterFee: trim2(
      trades.reduce((a, t) => a + t.profitOrLossAfterFee, 0),
    ),
    ...drawdownTradeStats(trades),
  };

  return { tradeStats, performance };
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function printHuman(
  trade: ReturnType<typeof buildStats>["tradeStats"],
  perf: ReturnType<typeof buildStats>["performance"],
  rewardLabel: string,
): void {
  console.log(chalk.cyan("\nTrading statistics"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold("Total round-trips: ") + chalk.green(String(trade.totalTrades)));
  console.log(chalk.bold("Winning:           ") + chalk.green(String(trade.win)));
  console.log(chalk.bold("Losing:            ") + chalk.red(String(trade.loss)));
  if (trade.breakeven > 0) {
    console.log(chalk.bold("Breakeven (gross): ") + chalk.yellow(String(trade.breakeven)));
  }
  console.log(chalk.bold("Win rate:          ") + chalk.yellow(trade.accuracy + "%"));
  console.log(chalk.bold("Max consec. wins:   ") + chalk.green(String(trade.maxConsecutiveWins)));
  console.log(chalk.bold("Max consec. losses: ") + chalk.red(String(trade.maxConsecutiveLosses)));

  console.log(chalk.bold("\nDirection"));
  console.log(chalk.bold("Short trades:      ") + chalk.blue(trade.shorts));
  console.log(chalk.bold("Short wins:        ") + chalk.green(trade.shortsWon));
  console.log(chalk.bold("Long trades:       ") + chalk.blue(trade.longs));
  console.log(chalk.bold("Long wins:         ") + chalk.green(trade.longsWon));

  console.log(chalk.bold(`\nReward (${rewardLabel})`));
  console.log(chalk.bold("Total:             ") + chalk.yellow(formatNum(perf.totalReward)));
  console.log(chalk.bold("Best:              ") + chalk.green(formatNum(perf.maxReward)));
  console.log(chalk.bold("Worst:             ") + chalk.red(formatNum(perf.minReward)));
  console.log(chalk.bold("Avg (winners):     ") + chalk.green(formatNum(perf.averageWinReward)));
  console.log(chalk.bold("Avg (losers):      ") + chalk.red(formatNum(perf.averageLossReward)));
  console.log(chalk.bold("Avg per trade:     ") + chalk.yellow(formatNum(perf.averageReward)));

  console.log(chalk.bold("\nP&L"));
  const pnlC = perf.totalProfitOrLoss >= 0 ? chalk.green : chalk.red;
  console.log(chalk.bold("Total (gross):     ") + pnlC(formatNum(perf.totalProfitOrLoss)));
  console.log(chalk.bold("Fees:              ") + chalk.red(formatNum(perf.fee)));
  console.log(chalk.bold("After fees:        ") + pnlC(formatNum(perf.profitOrLossAfterFee)));

  console.log(chalk.bold("\nRisk"));
  console.log(
    chalk.bold("Max drawdown (net): ") +
      chalk.red(formatNum(Math.abs(perf.maxDrawDown))),
  );
  console.log(
    chalk.bold("DD duration:        ") +
      chalk.yellow(perf.maxDrawDownDuration + " trades"),
  );
  console.log(
    chalk.bold("Avg trade length:   ") +
      chalk.yellow(trade.averageTradeCandle + " candles"),
  );
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}

function rewardLabelFor(opts: ParsedTradeInsightsOpts): string {
  return opts.riskPerTrade != null
    ? `R = PnL / fixed risk (${opts.riskPerTrade})`
    : opts.capital != null
      ? `R = PnL / (capital×5%) [capital=${opts.capital}]`
      : "R-like = PnL / entry notional (pass --risk-per-trade or --capital for engine-style R)";
}

async function analyze(opts: ParsedTradeInsightsOpts): Promise<{
  trades: RoundTrip[];
  stats: ReturnType<typeof buildStats>;
  rewardLabel: string;
}> {
  const rows = await loadRows(opts.path, opts.dedupe);
  const trades = aggregateRoundTrips(
    rows,
    opts.intervalMinutes,
    opts.riskPerTrade,
    opts.capital,
  );
  const stats = buildStats(trades);
  return { trades, stats, rewardLabel: rewardLabelFor(opts) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const base = parseArgs(argv);

  if (base.allSymbols) {
    const ql = await loadQuantlabConfig(base.configPath);
    const useInterval = argv.includes("--interval")
      ? base.intervalMinutes
      : intervalStringToMinutes(ql.interval);
    const useCapital =
      base.riskPerTrade != null
        ? null
        : argv.includes("--capital")
          ? base.capital
          : ql.capital;

    const batch: Array<{
      symbol: string;
      path: string;
      intervalMinutes: number;
      rewardNote: string;
      trade: ReturnType<typeof buildStats>["tradeStats"];
      performance: ReturnType<typeof buildStats>["performance"];
      roundTrips: RoundTrip[];
    }> = [];

    for (const symbol of ql.symbols) {
      const path = resolve(join(".data", "trades", `${symbol}.jsonl`));
      const opts: ParsedTradeInsightsOpts = {
        ...base,
        path,
        intervalMinutes: useInterval,
        capital: useCapital,
      };

      let result: Awaited<ReturnType<typeof analyze>>;
      try {
        result = await analyze(opts);
      } catch {
        console.warn(chalk.yellow(`Skip ${symbol}: could not read ${path}`));
        continue;
      }

      const { trades, stats, rewardLabel } = result;

      if (base.json) {
        batch.push({
          symbol,
          path: opts.path,
          intervalMinutes: useInterval,
          rewardNote: rewardLabel,
          trade: stats.tradeStats,
          performance: stats.performance,
          roundTrips: trades,
        });
        continue;
      }

      if (trades.length === 0) {
        console.log(
          chalk.dim(`No completed round-trips for ${symbol} (need entry + exit pairs).`),
        );
        continue;
      }

      console.log(chalk.magenta(`\n── ${symbol} ──`));
      printHuman(stats.tradeStats, stats.performance, rewardLabel);
    }

    if (base.json) {
      console.log(JSON.stringify({ symbols: batch }, null, 2));
    }
    return;
  }

  try {
    const { trades, stats, rewardLabel } = await analyze(base);
    if (base.json) {
      console.log(
        JSON.stringify(
          {
            path: base.path,
            intervalMinutes: base.intervalMinutes,
            rewardNote: rewardLabel,
            trade: stats.tradeStats,
            performance: stats.performance,
            roundTrips: trades,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (trades.length === 0) {
      console.log(
        chalk.dim("No completed round-trips (need entry + exit pairs)."),
      );
      process.exit(0);
    }

    printHuman(stats.tradeStats, stats.performance, rewardLabel);
  } catch {
    console.error(chalk.red(`Failed to read ${base.path}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
