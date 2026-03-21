/**
 * Live trade insights from Supabase `order_history` — same stats as `tradeInsights.ts`.
 *
 *   npx tsx scripts/liveApiInsights.ts
 *   npx tsx scripts/liveApiInsights.ts --json
 *
 * Env: `SUPABASE_URL` + `SUPABASE_KEY` (same as live mode), or `--supabase-url` / `--supabase-key`.
 */

import 'dotenv/config';
import chalk from 'chalk';
import type { OrderHistoryRecord } from '../src/core/types.js';
import { SupabaseStore } from '../src/store/SupabaseStore.js';
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

/** Bar-close / event time may be seconds in some paths; JSONL / DB normally use ms. */
function normalizeTimeMs(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
}

function closedRecordToRows(
  rec: OrderHistoryRecord,
  pairIndex: number,
): (JsonlRow & { lineIndex: number })[] {
  if (rec.status !== 'closed') return [];
  const side = rec.entrySide;
  if (side !== 'Buy' && side !== 'Sell') return [];
  const entryPx = rec.entryPrice;
  const exitPx = rec.exitPrice;
  const qty = rec.exitQty ?? rec.entryQty ?? 0;
  if (
    entryPx == null ||
    exitPx == null ||
    !Number.isFinite(entryPx) ||
    !Number.isFinite(exitPx) ||
    qty <= 0 ||
    !Number.isFinite(qty)
  ) {
    return [];
  }
  const entryTs = normalizeTimeMs(rec.entryTimestampMs ?? rec.entryAtMs ?? 0);
  const exitTs = normalizeTimeMs(rec.exitTimestampMs ?? rec.exitAtMs ?? 0);
  if (entryTs <= 0 || exitTs <= 0 || exitTs < entryTs) return [];
  const exitSide = side === 'Buy' ? 'Sell' : 'Buy';
  const entryFee = rec.entryFee ?? 0;
  const exitFee = rec.exitFee ?? 0;
  const base = pairIndex * 2;
  return [
    {
      symbol: rec.symbol,
      side,
      qty,
      price: entryPx,
      fee: entryFee,
      timestamp: entryTs,
      kind: 'entry' as const,
      lineIndex: base,
    },
    {
      symbol: rec.symbol,
      side: exitSide,
      qty,
      price: exitPx,
      fee: exitFee,
      timestamp: exitTs,
      kind: 'exit' as const,
      lineIndex: base + 1,
    },
  ];
}

function recordsToRows(records: OrderHistoryRecord[], dedupe: boolean): JsonlRow[] {
  const closed = records.filter((r) => r.status === 'closed');
  const withRows: (JsonlRow & { lineIndex: number })[] = [];
  let pairIndex = 0;
  for (const rec of closed) {
    const rows = closedRecordToRows(rec, pairIndex);
    if (rows.length === 2) {
      withRows.push(...rows);
      pairIndex++;
    }
  }
  return sortAndDedupeRows(withRows, dedupe);
}

interface Opts {
  store: SupabaseStore;
  json: boolean;
  activeOnly: boolean;
  dedupe: boolean;
  singleSymbol: string | null;
  intervalMinutes: number | null;
  capital: number | null;
  riskPerTrade: number | null;
}

function parseArgs(argv: string[]): Opts {
  let supabaseUrl = process.env.SUPABASE_URL?.trim() ?? '';
  let supabaseKey = process.env.SUPABASE_KEY?.trim() ?? '';
  let json = false;
  let activeOnly = true;
  let dedupe = true;
  let singleSymbol: string | null = null;
  let intervalMinutes: number | null = null;
  let capital: number | null = null;
  let riskPerTrade: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--supabase-url' && argv[i + 1]) supabaseUrl = argv[++i]!.trim();
    else if (a === '--supabase-key' && argv[i + 1]) supabaseKey = argv[++i]!.trim();
    else if (a === '--json') json = true;
    else if (a === '--include-stopped') activeOnly = false;
    else if (a === '--no-dedupe') dedupe = false;
    else if (a === '--symbol' && argv[i + 1]) singleSymbol = argv[++i]!.trim();
    else if (a === '--interval' && argv[i + 1]) intervalMinutes = Number(argv[++i]);
    else if (a === '--capital' && argv[i + 1]) capital = Number(argv[++i]);
    else if (a === '--risk-per-trade' && argv[i + 1]) riskPerTrade = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`liveApiInsights — trade stats from Supabase order_history (per deployed symbol)

Environment:
  SUPABASE_URL    Project URL
  SUPABASE_KEY    anon or service role (RLS must allow read on deployments + order_history)

Options:
  --supabase-url <url>   Override SUPABASE_URL
  --supabase-key <key>   Override SUPABASE_KEY
  --symbol <sym>         Only this symbol (skip deployment discovery); set --interval / --capital if needed
  --interval <minutes>   Bar length for avg trade in candles (else from deployment klineInterval, else 240)
  --capital <n>          For R = PnL / (capital×5%); defaults to deployment capital when listing from DB
  --risk-per-trade <n>   Fixed dollar risk for R
  --include-stopped      Include stopped deployments when building the symbol list
  --no-dedupe            Do not drop duplicate identical synthetic rows
  --json                 JSON only
`);
      process.exit(0);
    }
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error(chalk.red('Set SUPABASE_URL and SUPABASE_KEY (or pass --supabase-url / --supabase-key).'));
    process.exit(1);
  }

  return {
    store: new SupabaseStore(supabaseUrl, supabaseKey),
    json,
    activeOnly,
    dedupe,
    singleSymbol,
    intervalMinutes,
    capital,
    riskPerTrade,
  };
}

interface SymMeta {
  symbol: string;
  intervalMinutes: number;
  capital: number | null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  let targets: SymMeta[];

  if (opts.singleSymbol) {
    targets = [
      {
        symbol: opts.singleSymbol,
        intervalMinutes: opts.intervalMinutes ?? 240,
        capital: opts.capital,
      },
    ];
  } else {
    const deployments = await opts.store.loadDeployments();
    const filtered = opts.activeOnly
      ? deployments.filter((d) => d.status === 'active')
      : deployments;
    const bySymbol = new Map<string, SymMeta>();
    for (const d of filtered) {
      const intervalStr = d.klineInterval ?? '240';
      const im = opts.intervalMinutes ?? intervalStringToMinutes(intervalStr);
      if (!bySymbol.has(d.symbol)) {
        bySymbol.set(d.symbol, {
          symbol: d.symbol,
          intervalMinutes: im,
          capital: opts.capital ?? d.capital,
        });
      }
    }
    targets = [...bySymbol.values()];
  }

  if (opts.intervalMinutes != null) {
    targets = targets.map((t) => ({ ...t, intervalMinutes: opts.intervalMinutes! }));
  }
  if (opts.capital != null) {
    targets = targets.map((t) => ({ ...t, capital: opts.capital }));
  }

  const batch: Array<{
    symbol: string;
    intervalMinutes: number;
    rewardNote: string;
    trade: ReturnType<typeof buildStats>['tradeStats'];
    performance: ReturnType<typeof buildStats>['performance'];
    roundTrips: RoundTrip[];
  }> = [];

  for (const t of targets.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    let orders: OrderHistoryRecord[];
    try {
      orders = await opts.store.listOrderHistory({ symbol: t.symbol, status: 'closed' });
    } catch (e) {
      if (!opts.json) console.warn(chalk.yellow(`Skip ${t.symbol}: ${String(e)}`));
      continue;
    }

    const rows = recordsToRows(orders, opts.dedupe);
    const trades = aggregateRoundTrips(
      rows,
      t.intervalMinutes,
      opts.riskPerTrade,
      t.capital,
    );
    const stats = buildStats(trades);
    const rewardLabel = rewardLabelFor({
      riskPerTrade: opts.riskPerTrade,
      capital: t.capital,
    });

    if (opts.json) {
      batch.push({
        symbol: t.symbol,
        intervalMinutes: t.intervalMinutes,
        rewardNote: rewardLabel,
        trade: stats.tradeStats,
        performance: stats.performance,
        roundTrips: trades,
      });
      continue;
    }

    if (trades.length === 0) {
      console.log(
        chalk.dim(`No completed round-trips for ${t.symbol} (closed order_history with entry/exit).`),
      );
      continue;
    }

    console.log(chalk.magenta(`\n── ${t.symbol} (interval ${t.intervalMinutes}m) ──`));
    printHuman(stats.tradeStats, stats.performance, rewardLabel);
  }

  if (opts.json) {
    console.log(JSON.stringify({ symbols: batch }, null, 2));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
