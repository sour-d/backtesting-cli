/**
 * Compare new-repo trade JSONL (per fill / persistTrade) with old-repo result.json (tradeResults[]).
 *
 * Usage (from backtesting-cli root):
 *   npx tsx scripts/compareBacktestTradeResults.ts
 *   npx tsx scripts/compareBacktestTradeResults.ts --new .data/backtest/trades/SOLUSDT_5.jsonl --old ../backtesting-cli-old/.data/results/result.json
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadQuantlabConfig } from "../src/config/loadConfig.js";
import {
  backtestTradesDir,
  backtestTradeFileName,
} from "../src/engine/backtestSummary.js";

type Side = "Buy" | "Sell";
type Kind = "entry" | "exit";

interface NormalizedEvent {
  readonly timestamp: number;
  readonly kind: Kind;
  readonly side: Side;
  readonly price: number;
  readonly qty: number;
}

interface NewRow {
  readonly timestamp: number;
  readonly kind: Kind;
  readonly side: Side;
  readonly price: number;
  readonly qty: number;
}

interface OldResultFile {
  readonly tradeResults?: OldTradeRow[];
}

interface OldTradeRow {
  readonly transactionDate?: { dateUnix?: number };
  readonly price: number;
  readonly quantity: number;
  readonly transactionType: string;
  readonly symbol?: string;
}

function parseArgs(argv: string[]): {
  newPathExplicit: string | undefined;
  oldPath: string;
  symbol: string;
  priceEps: number;
  qtyEps: number;
  maxReport: number;
  dedupeNew: boolean;
} {
  let newPathExplicit: string | undefined;
  let oldPath = "../backtesting-cli-old/.data/results/result.json";
  let symbol = "SOLUSDT";
  let priceEps = 1e-6;
  let qtyEps = 1e-9;
  let maxReport = 50;
  let dedupeNew = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new" && argv[i + 1]) {
      newPathExplicit = argv[++i];
    } else if (a === "--old" && argv[i + 1]) {
      oldPath = argv[++i];
    } else if (a === "--symbol" && argv[i + 1]) {
      symbol = argv[++i];
    } else if (a === "--price-eps" && argv[i + 1]) {
      priceEps = Number(argv[++i]);
    } else if (a === "--qty-eps" && argv[i + 1]) {
      qtyEps = Number(argv[++i]);
    } else if (a === "--max-report" && argv[i + 1]) {
      maxReport = Number(argv[++i]);
    } else if (a === "--no-dedupe") {
      dedupeNew = false;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: compareBacktestTradeResults [options]

Options:
  --new <path>        New repo JSONL (default: quantlab.config.js → backtest/trades/{SYM}_{INTERVAL}.jsonl)
  --old <path>        Old repo result.json (default: ../backtesting-cli-old/.data/results/result.json)
  --symbol <sym>      Filter old tradeResults by symbol (default: SOLUSDT)
  --price-eps <n>     Absolute tolerance for price (default: 1e-6)
  --qty-eps <n>       Absolute tolerance for qty (default: 1e-9)
  --max-report <n>    Max mismatch lines to print (default: 50)
  --no-dedupe         Keep duplicate identical rows in the new JSONL (default: dedupe)
`);
      process.exit(0);
    }
  }

  return {
    newPathExplicit,
    oldPath: resolve(oldPath),
    symbol,
    priceEps,
    qtyEps,
    maxReport,
    dedupeNew,
  };
}

function eventKey(e: NormalizedEvent): string {
  return `${e.timestamp}|${e.kind}|${e.side}|${e.price}|${e.qty}`;
}

function dedupeEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

interface NewRowWithLine extends NormalizedEvent {
  readonly lineIndex: number;
}

async function loadNewJsonl(
  path: string,
  dedupe: boolean,
): Promise<NormalizedEvent[]> {
  const raw = await readFile(path, "utf8");
  const rows: NewRowWithLine[] = [];
  let lineIndex = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const row = JSON.parse(t) as NewRow;
    if (row.kind !== "entry" && row.kind !== "exit") {
      throw new Error(`Unknown kind in ${path}: ${String((row as { kind?: unknown }).kind)}`);
    }
    if (row.side !== "Buy" && row.side !== "Sell") {
      throw new Error(`Unknown side in ${path}: ${String(row.side)}`);
    }
    rows.push({
      timestamp: row.timestamp,
      kind: row.kind,
      side: row.side,
      price: row.price,
      qty: row.qty,
      lineIndex: lineIndex++,
    });
  }
  rows.sort((a, b) => a.timestamp - b.timestamp || a.lineIndex - b.lineIndex);
  const stripped: NormalizedEvent[] = rows.map(
    ({ timestamp, kind, side, price, qty }) => ({
      timestamp,
      kind,
      side,
      price,
      qty,
    }),
  );
  return dedupe ? dedupeEvents(stripped) : stripped;
}

function normalizeOldTradeResults(
  rows: OldTradeRow[],
  symbolFilter: string,
): NormalizedEvent[] {
  const filtered = rows.filter((r) => (r.symbol ?? symbolFilter) === symbolFilter);
  const out: NormalizedEvent[] = [];
  let position: "flat" | "long" | "short" = "flat";

  for (const tr of filtered) {
    const t = tr.transactionDate?.dateUnix;
    if (t === undefined) {
      throw new Error("Old trade missing transactionDate.dateUnix");
    }
    const ty = tr.transactionType;
    if (ty === "Buy" || ty === "Sell") {
      if (position !== "flat") {
        throw new Error(
          `Old result: entry (${ty}) while position is ${position} — unexpected sequence`,
        );
      }
      out.push({
        timestamp: t,
        kind: "entry",
        side: ty,
        price: tr.price,
        qty: tr.quantity,
      });
      position = ty === "Buy" ? "long" : "short";
      continue;
    }
    if (ty === "square-off") {
      if (position === "flat") {
        throw new Error("Old result: square-off while flat");
      }
      const exitSide: Side = position === "long" ? "Sell" : "Buy";
      out.push({
        timestamp: t,
        kind: "exit",
        side: exitSide,
        price: tr.price,
        qty: tr.quantity,
      });
      position = "flat";
      continue;
    }
    throw new Error(`Unknown old transactionType: ${ty}`);
  }

  if (position !== "flat") {
    throw new Error("Old result: ended with an open position");
  }

  return out;
}

async function loadOldResult(path: string, symbol: string): Promise<NormalizedEvent[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as OldResultFile;
  const rows = parsed.tradeResults;
  if (!Array.isArray(rows)) {
    throw new Error(`${path}: missing tradeResults[]`);
  }
  return normalizeOldTradeResults(rows as OldTradeRow[], symbol);
}

function approxEq(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function compareEvents(
  a: NormalizedEvent,
  b: NormalizedEvent,
  priceEps: number,
  qtyEps: number,
): { ok: boolean; detail: string } {
  if (a.timestamp !== b.timestamp) {
    return { ok: false, detail: `timestamp ${a.timestamp} vs ${b.timestamp}` };
  }
  if (a.kind !== b.kind) {
    return { ok: false, detail: `kind ${a.kind} vs ${b.kind}` };
  }
  if (a.side !== b.side) {
    return { ok: false, detail: `side ${a.side} vs ${b.side}` };
  }
  if (!approxEq(a.price, b.price, priceEps)) {
    return { ok: false, detail: `price ${a.price} vs ${b.price}` };
  }
  if (!approxEq(a.qty, b.qty, qtyEps)) {
    return { ok: false, detail: `qty ${a.qty} vs ${b.qty}` };
  }
  return { ok: true, detail: "" };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const ql = await loadQuantlabConfig(
    resolve(process.cwd(), "quantlab.config.js"),
  );
  const newPath = resolve(
    parsed.newPathExplicit ??
      join(
        backtestTradesDir(".data"),
        backtestTradeFileName(ql.symbols[0]!, ql.interval),
      ),
  );
  const [newEvents, oldEvents] = await Promise.all([
    loadNewJsonl(newPath, parsed.dedupeNew),
    loadOldResult(parsed.oldPath, parsed.symbol),
  ]);

  console.log("Paths:");
  console.log(
    `  new: ${newPath} (${newEvents.length} events${parsed.dedupeNew ? ", deduped" : ""})`,
  );
  console.log(`  old: ${parsed.oldPath} (${oldEvents.length} events)`);
  console.log("");

  const n = Math.min(newEvents.length, oldEvents.length);
  let pairMismatches = 0;
  let firstMismatchIndex: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = compareEvents(
      newEvents[i],
      oldEvents[i],
      parsed.priceEps,
      parsed.qtyEps,
    );
    if (!c.ok) {
      pairMismatches++;
      if (firstMismatchIndex === null) firstMismatchIndex = i;
      if (pairMismatches <= parsed.maxReport) {
        console.log(`[${i}] MISMATCH: ${c.detail}`);
        console.log(`    new: ${eventKey(newEvents[i])}`);
        console.log(`    old: ${eventKey(oldEvents[i])}`);
        console.log("");
      }
    }
  }

  const lenDelta = Math.abs(newEvents.length - oldEvents.length);
  if (lenDelta > 0) {
    console.log(
      `Length differs: new ${newEvents.length} vs old ${oldEvents.length} (pairwise compared first ${n} rows).`,
    );
  }

  if (pairMismatches === 0 && lenDelta === 0) {
    console.log(`OK: all ${newEvents.length} events match within tolerance.`);
    process.exit(0);
  }

  if (firstMismatchIndex !== null) {
    console.log(`First mismatch at index ${firstMismatchIndex}`);
  }
  const reported = Math.min(pairMismatches, parsed.maxReport);
  if (pairMismatches > parsed.maxReport) {
    console.log(`(${pairMismatches - parsed.maxReport} more pairwise mismatches not shown.)`);
  }
  console.log(
    `Summary: ${pairMismatches} pairwise mismatch(es); length delta ${lenDelta}; showed ${reported} detail line(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
