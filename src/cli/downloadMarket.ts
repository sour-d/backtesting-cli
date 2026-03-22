import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { KlineIntervalV3 } from 'bybit-api';
import { RestClientV5 } from 'bybit-api';
import { loadQuantlabConfig, parseConfigTimeRange } from '../config/loadConfig.js';
import { fetchKlinesRangeChunked } from '../exchange/bybit/fetchKlinesChunked.js';

export interface DownloadMarketOptions {
  readonly configPath: string;
  readonly dataDir: string;
  readonly testnet: boolean;
}

/**
 * Load `quantlab.config.js`, fetch OHLCV per symbol (sequential), write `.data/market/{symbol}_{interval}.json`.
 * Re-runs **replace** each file in full (`writeFile`); there is no merge or reconciliation with previous downloads.
 */
export async function runDownloadMarket(opts: DownloadMarketOptions): Promise<void> {
  const absConfig = resolve(opts.configPath);
  const config = await loadQuantlabConfig(absConfig);
  const { rangeStartMs, rangeEndMs } = parseConfigTimeRange(config);
  const rest = new RestClientV5({ testnet: opts.testnet });
  const interval = config.interval as KlineIntervalV3;
  const category = config.category;

  const outDir = join(resolve(opts.dataDir), 'market');
  await mkdir(outDir, { recursive: true });

  for (const symbol of config.symbols) {
    const { candles, windowCount } = await fetchKlinesRangeChunked(rest, {
      category,
      symbol,
      interval,
      rangeStartMs,
      rangeEndMs,
      onChunk: (chunk) => {
        console.info(
          '[download-market] kline window',
          JSON.stringify({
            symbol: chunk.symbol,
            interval: chunk.interval,
            window: `${chunk.windowIndex}/${chunk.windowsTotal}`,
            pageInWindow: chunk.pageInWindow,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            rows: chunk.rowsReturned,
          }),
        );
      },
    });
    const fileName = `${symbol}_${interval}.json`;
    const filePath = join(outDir, fileName);
    // Truncate + replace entire file on every run.
    await writeFile(filePath, `${JSON.stringify(candles, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify({
        symbol,
        interval,
        bars: candles.length,
        chunkWindows: windowCount,
        path: filePath,
      }),
    );
  }

  console.log(
    JSON.stringify({
      done: true,
      symbols: config.symbols.length,
      category,
      rangeStartMs,
      rangeEndMs,
    }),
  );
}
