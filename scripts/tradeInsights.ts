/**
 * Insights from new-repo trade JSONL (same spirit as backtesting-cli-old `results.js` + CLI summary).
 *
 *   npx tsx scripts/tradeInsights.ts
 *   npx tsx scripts/tradeInsights.ts --json > insights.json
 */

import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import chalk from 'chalk';
import { loadQuantlabConfig } from '../src/config/loadConfig.js';
import {
  backtestTradesDir,
  backtestTradeFileName,
  listBacktestTradeJsonlFiles,
} from '../src/engine/backtestSummary.js';
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

interface ParsedTradeInsightsCli {
  readonly explicitPath: string | undefined;
  readonly intervalMinutes: number;
  readonly dedupe: boolean;
  readonly json: boolean;
  readonly riskPerTrade: number | null;
  readonly capital: number | null;
  readonly allSymbols: boolean;
  readonly configPath: string;
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

function parseArgs(argv: string[]): ParsedTradeInsightsCli {
  let explicitPath: string | undefined;
  let intervalMinutes = 240;
  let dedupe = true;
  let json = false;
  let riskPerTrade: number | null = null;
  let capital: number | null = null;
  let allSymbols = false;
  let configPath = 'quantlab.config.js';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path' && argv[i + 1]) explicitPath = resolve(argv[++i]);
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

Default: every *.jsonl under .data/backtest/trades/ (same folder the backtest engine writes).

Options:
  --path <file>          Single trade JSONL (skip folder scan)
  --interval <minutes>   Bar length in minutes for avg trade length (default: from config when omitted)
  --no-dedupe            Do not drop duplicate identical rows
  --risk-per-trade <n>   Fixed $ risk for PnL / risk (like old engine)
  --capital <n>          With no --risk-per-trade, risk = capital * 5%
  --all-symbols          Only files for symbols in quantlab.config.js ({SYM}_{INTERVAL}.jsonl under trades/)
  --config <file>        Quantlab config (default: quantlab.config.js)
  --json                 Print JSON only (no chalk)
`);
      process.exit(0);
    }
  }

  return {
    explicitPath,
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

async function runInsightsBatch(
  items: ReadonlyArray<{ readonly label: string; readonly path: string }>,
  base: Omit<ParsedTradeInsightsOpts, 'path'>,
  argv: string[],
  ql: Awaited<ReturnType<typeof loadQuantlabConfig>>,
): Promise<void> {
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

  for (const { label, path } of items) {
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
      console.warn(chalk.yellow(`Skip ${label}: could not read ${path}`));
      continue;
    }

    const { trades, stats, rewardLabel } = result;

    if (base.json) {
      batch.push({
        symbol: label,
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
        chalk.dim(`No completed round-trips for ${label} (need entry + exit pairs).`),
      );
      continue;
    }

    console.log(chalk.magenta(`\n── ${label} ──`));
    printHuman(stats.tradeStats, stats.performance, rewardLabel);
  }

  if (base.json) {
    console.log(JSON.stringify({ symbols: batch }, null, 2));
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cli = parseArgs(argv);
  const ql = await loadQuantlabConfig(cli.configPath);
  const { explicitPath, ...cliRest } = cli;
  const baseRest = { ...cliRest } as Omit<ParsedTradeInsightsOpts, 'path'>;

  if (cli.allSymbols) {
    const items = ql.symbols.map((symbol) => ({
      label: symbol,
      path: resolve(
        join(backtestTradesDir('.data'), backtestTradeFileName(symbol, ql.interval)),
      ),
    }));
    await runInsightsBatch(items, baseRest, argv, ql);
    return;
  }

  if (explicitPath) {
    const base: ParsedTradeInsightsOpts = { ...cliRest, path: explicitPath, allSymbols: false };
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
    return;
  }

  const discovered = await listBacktestTradeJsonlFiles('.data');
  if (discovered.length === 0) {
    console.log(chalk.dim('No .jsonl files in .data/backtest/trades'));
    return;
  }

  const items = discovered.map((p) => ({
    label: basename(p, '.jsonl'),
    path: resolve(p),
  }));
  await runInsightsBatch(items, baseRest, argv, ql);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
