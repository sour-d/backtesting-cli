import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Root directory for backtest file artifacts: `{dataDir}/backtest`. */
export function backtestDir(dataDir: string): string {
  return join(dataDir, 'backtest');
}

/** Per-run trade JSONL files live here: `{dataDir}/backtest/trades`. */
export function backtestTradesDir(dataDir: string): string {
  return join(backtestDir(dataDir), 'trades');
}

/** Trade JSONL filename: `{symbol}_{interval}.jsonl` (matches market file interval codes). */
export function backtestTradeFileName(symbol: string, intervalRaw: string | undefined): string {
  const i = (intervalRaw ?? 'unknown').trim().replace(/\s+/g, '') || 'unknown';
  return `${symbol}_${i}.jsonl`;
}

/**
 * Start of each backtest run: clear prior trade JSONL under `backtest/trades/`, reset deployments/positions,
 * and remove legacy `*.jsonl` at `backtest/` root if present.
 */
export async function prepareBacktestRun(dataDir: string): Promise<void> {
  const root = backtestDir(dataDir);
  await mkdir(root, { recursive: true });
  const tradesRoot = backtestTradesDir(dataDir);
  await mkdir(tradesRoot, { recursive: true });

  try {
    const tradeNames = await readdir(tradesRoot);
    for (const name of tradeNames) {
      if (name.endsWith('.jsonl')) {
        await rm(join(tradesRoot, name), { force: true });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const names = await readdir(root);
    for (const name of names) {
      if (name.endsWith('.jsonl')) {
        await rm(join(root, name), { force: true });
      }
    }
  } catch {
    /* ignore */
  }

  await writeFile(join(root, 'deployments.json'), '[]\n', 'utf8');
  await writeFile(join(root, 'positions.json'), '[]\n', 'utf8');
}

/** Sorted absolute-style paths to each `*.jsonl` under `{dataDir}/backtest/trades/`. */
export async function listBacktestTradeJsonlFiles(dataDir: string): Promise<string[]> {
  const dir = backtestTradesDir(dataDir);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.endsWith('.jsonl'))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** Count JSONL lines under `{dataDir}/backtest/trades/*.jsonl` (per symbol+interval trade rows). */
export async function countBacktestTradeRecords(dataDir: string): Promise<number> {
  const dir = backtestTradesDir(dataDir);
  let total = 0;
  try {
    const files = await readdir(dir);
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const raw = await readFile(join(dir, name), 'utf8');
      for (const line of raw.split('\n')) {
        if (line.trim()) total += 1;
      }
    }
  } catch {
    /* missing dir — zero trades */
  }
  return total;
}
