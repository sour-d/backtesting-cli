import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Count JSONL lines under `{dataDir}/trades/*.jsonl` (Bot `persistTrade` output). */
export async function countBacktestTradeRecords(dataDir: string): Promise<number> {
  const tradesDir = join(dataDir, 'trades');
  let total = 0;
  try {
    const files = await readdir(tradesDir);
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const raw = await readFile(join(tradesDir, name), 'utf8');
      for (const line of raw.split('\n')) {
        if (line.trim()) total += 1;
      }
    }
  } catch {
    /* missing dir — zero trades */
  }
  return total;
}
