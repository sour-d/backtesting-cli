/**
 * List completed round-trips from trade JSONL (same layout as legacy `runTradesCommand`).
 *
 *   npx tsx scripts/listCompletedTrades.ts
 *   yarn list:trades
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { loadQuantlabConfig } from "../src/config/loadConfig.js";
import {
  backtestTradesDir,
  backtestTradeFileName,
} from "../src/engine/backtestSummary.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = "Asia/Kolkata";

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

interface OpenLeg {
  readonly symbol: string;
  readonly type: "Long" | "Short";
  readonly entryPrice: number;
  readonly qty: number;
  readonly entryFee: number;
  readonly entryTs: number;
}

interface CompletedTrade {
  readonly symbol: string;
  readonly type: "Long" | "Short";
  readonly qty: number;
  readonly entryTs: number;
  readonly exitTs: number;
  readonly profitOrLossGross: number;
  readonly profitOrLossAfterFee: number;
}

function trim2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseArgs(argv: string[]): {
  explicitPath: string | undefined;
  dedupe: boolean;
  json: boolean;
  csv: boolean;
} {
  let explicitPath: string | undefined;
  let dedupe = true;
  let json = false;
  let csv = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" && argv[i + 1]) explicitPath = resolve(argv[++i]);
    else if (a === "--file" && argv[i + 1]) explicitPath = resolve(argv[++i]);
    else if (a === "--no-dedupe") dedupe = false;
    else if (a === "--json") json = true;
    else if (a === "--csv") csv = true;
    else if (a === "--help" || a === "-h") {
      console.log(`listCompletedTrades — closed trades from JSONL (IST)

Options:
  --path, --file <file>   Trade JSONL (default: quantlab.config.js → backtest/trades/{SYM}_{INTERVAL}.jsonl)
  --no-dedupe             Keep duplicate identical rows
  --csv                   CSV (machine-readable)
  --json                  JSON array
`);
      process.exit(0);
    }
  }
  return { explicitPath, dedupe, json, csv };
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
  rows.sort(
    (a, b) => a.timestamp - b.timestamp || a.lineIndex - b.lineIndex,
  );
  const sorted = rows.map(({ lineIndex: _, ...rest }) => rest as JsonlRow);
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

function aggregateCompleted(rows: JsonlRow[]): CompletedTrade[] {
  const openBySymbol = new Map<string, OpenLeg>();
  const out: CompletedTrade[] = [];

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
      const fees = open.entryFee + r.fee;

      out.push({
        symbol: r.symbol,
        type: open.type,
        qty: open.qty,
        entryTs: open.entryTs,
        exitTs: r.timestamp,
        profitOrLossGross: trim2(gross),
        profitOrLossAfterFee: trim2(gross - fees),
      });
      openBySymbol.delete(r.symbol);
    }
  }

  for (const sym of openBySymbol.keys()) {
    console.warn(`Warning: open position still on book (omitted): ${sym}`);
  }

  return out;
}

function formatIST(ms: number | null): string {
  if (ms == null) return "—";
  return dayjs(ms).tz(IST).format("YYYY-MM-DD HH:mm:ss");
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtQty(q: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(q);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const ql = await loadQuantlabConfig(
    resolve(process.cwd(), "quantlab.config.js"),
  );
  const path =
    parsed.explicitPath ??
    resolve(
      join(
        backtestTradesDir(".data"),
        backtestTradeFileName(ql.symbols[0]!, ql.interval),
      ),
    );
  let rows: JsonlRow[];
  try {
    rows = await loadRows(path, parsed.dedupe);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      chalk.red(
        `Failed to read ${path}: ${msg}\nPass --path <file> to your trade JSONL.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const trades = aggregateCompleted(rows);

  if (parsed.json) {
    const payload = trades.map((t, i) => ({
      id: i + 1,
      symbol: t.symbol,
      type: t.type,
      qty: t.qty,
      entryTimeIst: formatIST(t.entryTs),
      exitTimeIst: formatIST(t.exitTs),
      entryTsUnix: t.entryTs,
      exitTsUnix: t.exitTs,
      profitOrLoss: t.profitOrLossGross,
      profitOrLossAfterFee: t.profitOrLossAfterFee,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (trades.length === 0) {
    console.log(chalk.dim("No closed trades in file."));
    return;
  }

  const rowsOut = trades.map((t, i) => {
    const gross = t.profitOrLossGross;
    const net = t.profitOrLossAfterFee;
    return {
      id: i + 1,
      entryIst: formatIST(t.entryTs),
      exitIst: formatIST(t.exitTs),
      qty: t.qty,
      qtyStr: fmtQty(t.qty),
      gross,
      net,
      symbol: t.symbol,
      type: t.type,
    };
  });

  if (parsed.csv) {
    const header =
      "id,entry_datetime_ist,exit_datetime_ist,qty,pnl_gross,pnl_after_fee,symbol,type";
    const lines = rowsOut.map(
      (r) =>
        `${r.id},"${r.entryIst}","${r.exitIst}",${r.qty},${r.gross},${r.net},${r.symbol},${r.type}`,
    );
    console.log([header, ...lines].join("\n"));
    return;
  }

  const entryLabel = "Entry (IST)";
  const exitLabel = "Exit (IST)";
  const idW = Math.max(2, ...rowsOut.map((r) => String(r.id).length));
  const entryW = Math.max(
    entryLabel.length,
    ...rowsOut.map((r) => r.entryIst.length),
  );
  const exitW = Math.max(
    exitLabel.length,
    ...rowsOut.map((r) => r.exitIst.length),
  );
  const qtyLabel = "qty";
  const qtyW = Math.max(
    qtyLabel.length,
    ...rowsOut.map((r) => r.qtyStr.length),
  );
  const ruleLen =
    idW +
    2 +
    entryW +
    2 +
    exitW +
    2 +
    qtyW +
    2 +
    14 +
    2 +
    16 +
    2 +
    8;

  console.log(chalk.cyan("\nClosed trades (from JSONL)\n"));
  console.log(
    chalk.bold(
      `${"id".padStart(idW)}  ${entryLabel.padEnd(entryW)}  ${exitLabel.padEnd(exitW)}  ${qtyLabel.padStart(qtyW)}  ${"P&L".padStart(14)}  ${"P&L (after fee)".padStart(16)}  symbol`,
    ),
  );
  console.log(chalk.dim("─".repeat(ruleLen)));

  for (const r of rowsOut) {
    const gStr = fmt(r.gross);
    const nStr = fmt(r.net);
    const gCol = r.gross >= 0 ? chalk.green : chalk.red;
    const nCol = r.net >= 0 ? chalk.green : chalk.red;
    console.log(
      `${String(r.id).padStart(idW)}  ${r.entryIst.padEnd(entryW)}  ${r.exitIst.padEnd(exitW)}  ${r.qtyStr.padStart(qtyW)}  ${gCol(gStr.padStart(14))}  ${nCol(nStr.padStart(16))}  ${r.symbol}`,
    );
  }

  console.log(
    chalk.dim(
      `\nEntry and exit times are ${IST}. --csv for machine-readable output.\n`,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
