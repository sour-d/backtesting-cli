import type { Candle } from '../types/index.js';
import type { IStore } from '../store/IStore.js';
import type { ILogger } from '../logger/ILogger.js';
import type { Market } from '../market/Market.js';
import type { Bot } from '../trading-bot/Bot.js';
import { BybitClient } from './exchange/BybitClient.js';
import { safeErrorMessage } from '../utils/safeErrorMessage.js';

export interface WarmupOpts {
  symbols: readonly string[];
  interval: string;
  category?: 'linear' | 'spot' | 'inverse';
  count: number;
  store: IStore;
  market: Market;
  bot: Bot;
  logger: ILogger;
  testnet?: boolean;
}

/**
 * Load recent historical candles for each symbol and pre-populate Market
 * indicators so the bot can trade on the first live WebSocket candle.
 *
 * Strategy:
 *  1. Load from DB (fast, no API call)
 *  2. Check freshness: is the latest candle within the last 2 candle periods?
 *  3. If stale or fewer than `count`, fetch from Bybit REST and merge
 *  4. Final set = most recent `count` completed candles from now
 */
export async function warmupMarket(opts: WarmupOpts): Promise<void> {
  const { symbols, interval, count, store, market, bot, logger } = opts;
  const category = opts.category ?? 'linear';
  const candleMs = intervalMs(interval);

  for (const symbol of symbols) {
    try {
      const dbCandles = await loadFromDb(store, symbol, interval, count);

      const latestDbTs = dbCandles.length > 0 ? dbCandles[dbCandles.length - 1]!.dateUnix : 0;
      const isFresh = latestDbTs > 0 && (Date.now() - latestDbTs) <= 2 * candleMs;
      const isSufficient = dbCandles.length >= count;

      let candles: Candle[];

      if (isFresh && isSufficient) {
        candles = dbCandles;
        logger.info('Warmup loaded from DB', { symbol, count: String(candles.length) });
      } else {
        const reason = !isFresh ? 'stale' : 'insufficient';
        logger.info('DB warmup data ' + reason + ', fetching from API', {
          symbol,
          dbCount: String(dbCandles.length),
          latestAge: latestDbTs > 0 ? String(Math.round((Date.now() - latestDbTs) / 60_000)) + 'min' : 'none',
        });

        const apiCandles = await fetchFromApi(opts, symbol, interval, count, category);

        if (apiCandles.length > 0) {
          candles = mergeCandles(dbCandles, apiCandles);
          void saveToDb(store, symbol, interval, apiCandles, logger);
        } else {
          candles = dbCandles;
        }
      }

      if (candles.length === 0) {
        logger.warn('No historical candles available for warmup', { symbol });
        continue;
      }

      // Sort chronologically, take the most recent `count`, exclude unclosed candle
      candles.sort((a, b) => a.dateUnix - b.dateUnix);
      if (candles.length > count) candles = candles.slice(-count);

      const now = Date.now();
      candles = candles.filter((c) => c.dateUnix + candleMs <= now);

      if (candles.length === 0) {
        logger.warn('No completed candles for warmup after filtering', { symbol });
        continue;
      }

      market.registerSymbol(symbol, candles);
      bot.setHistoryCount(symbol, candles.length);

      logger.info('Warmup complete', {
        symbol,
        candles: String(candles.length),
        from: candles[0]!.date + ' ' + candles[0]!.time,
        to: candles[candles.length - 1]!.date + ' ' + candles[candles.length - 1]!.time,
      });
    } catch (err) {
      logger.error('Warmup failed for symbol (continuing without history)', {
        symbol,
        error: safeErrorMessage(err),
      });
    }
  }
}

async function loadFromDb(
  store: IStore,
  symbol: string,
  interval: string,
  count: number,
): Promise<Candle[]> {
  if (!store.queryCandles) return [];
  try {
    const rows = await store.queryCandles({
      symbol,
      interval,
      limit: count,
      order: 'desc',
    });
    return rows.reverse();
  } catch {
    return [];
  }
}

async function fetchFromApi(
  opts: WarmupOpts,
  symbol: string,
  interval: string,
  count: number,
  category: 'linear' | 'spot' | 'inverse',
): Promise<Candle[]> {
  try {
    const client = new BybitClient({
      testnet: opts.testnet ?? false,
      logger: opts.logger.child({ component: 'WarmupClient' }),
    });
    const candles = await client.fetchRecentCandles({
      symbol,
      interval,
      limit: count + 5,
      category,
    });
    return candles;
  } catch (err) {
    opts.logger.warn('REST API warmup fetch failed (will use DB data)', {
      symbol,
      error: safeErrorMessage(err),
    });
    return [];
  }
}

function saveToDb(
  store: IStore,
  symbol: string,
  interval: string,
  candles: readonly Candle[],
  logger: ILogger,
): Promise<void> {
  return store.saveCandles(symbol, interval, candles).catch((err) => {
    logger.warn('Failed to save warmup candles to DB', { symbol, error: safeErrorMessage(err) });
  });
}

function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const seen = new Set(a.map((c) => c.dateUnix));
  const merged = [...a];
  for (const c of b) {
    if (!seen.has(c.dateUnix)) {
      merged.push(c);
      seen.add(c.dateUnix);
    }
  }
  return merged;
}

function intervalMs(interval: string): number {
  const minutes: Record<string, number> = {
    '1': 1, '3': 3, '5': 5, '15': 15, '30': 30,
    '60': 60, '120': 120, '240': 240, '360': 360, '720': 720,
    D: 1440, W: 10080, M: 43200,
  };
  return (minutes[interval] ?? 240) * 60_000;
}
