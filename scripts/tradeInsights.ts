/**
 * Insights from new-repo trade JSONL (same spirit as backtesting-cli-old `results.js` + CLI summary).
 *
 *   npx tsx scripts/tradeInsights.ts
 *   npx tsx scripts/tradeInsights.ts --json > insights.json
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { loadQuantlabConfig } from '../src/config/loadConfig.js';
import {
  aggregateRoundTrips,
  buildStats,
  intervalStringToMinutes,
  printHuman,
  rewardLabelFor,
  sortAndDedupeRows,
  type JsonlRow,
  type RoundTrip,
} from './lib/tradeInsightCore.js';

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
  let path = '.data/trades/SOLUSDT.jsonl';
  let intervalMinutes = 240;
  let dedupe = true;
  let json = false;
  let riskPerTrade: number | null = null;
  let capital: number | null = null;
  let allSymbols = false;
  let configPath = 'quantlab.config.js';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path' && argv[i + 1]) path = argv[++i];
    else if (a === '--interval' && argv[i + 1])
      intervalMinutes = Number(argv[++i]);
    else if (a === '--no-dedupe') dedupe = false;
    else if (a === '--json') json = true;
    else if (a === '--risk-per-trade' && argv[i + 1])
      riskPerTrade = Number(argv[++i]);
    else if (a === '--capital' && argv[i + 1]) capital = Number(argv[++i]);
    else if (a === '--all-symbols') allSymbols = true;
    else if (a === '--config' && argv[i + 1]) configPath = argv[++i];
    else if (a === '--help' || a === '-h') {
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

async function loadRows(file: string, dedupe: boolean): Promise<JsonlRow[]> {
  const raw = await readFile(file, 'utf8');
  const rows: (JsonlRow & { lineIndex: number })[] = [];
  let lineIndex = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const r = JSON.parse(t) as JsonlRow;
    rows.push({ ...r, lineIndex });
    lineIndex++;
  }
  return sortAndDedupeRows(rows, dedupe);
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
  return {
    trades,
    stats,
    rewardLabel: rewardLabelFor({
      riskPerTrade: opts.riskPerTrade,
      capital: opts.capital,
    }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const base = parseArgs(argv);

  if (base.allSymbols) {
    const ql = await loadQuantlabConfig(base.configPath);
    const useInterval = argv.includes('--interval')
      ? base.intervalMinutes
      : intervalStringToMinutes(ql.interval);
    const useCapital =
      base.riskPerTrade != null
        ? null
        : argv.includes('--capital')
          ? base.capital
          : ql.capital;

    const batch: Array<{
      symbol: string;
      path: string;
      intervalMinutes: number;
      rewardNote: string;
      trade: ReturnType<typeof buildStats>['tradeStats'];
      performance: ReturnType<typeof buildStats>['performance'];
      roundTrips: RoundTrip[];
    }> = [];

    for (const symbol of ql.symbols) {
      const path = resolve(join('.data', 'trades', `${symbol}.jsonl`));
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
      console.log(chalk.dim('No completed round-trips (need entry + exit pairs).'));
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
