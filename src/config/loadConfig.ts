import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

const TIME_FMT = 'YYYY-MM-DD HH:mm';

export interface QuantlabConfig {
  readonly symbols: readonly string[];
  readonly interval: string;
  readonly start: string;
  readonly end: string;
  readonly category: 'linear' | 'spot' | 'inverse';
  readonly strategy: string;
  readonly capital: number;
  readonly feeRate: number;
}

export interface QuantlabTimeBounds {
  readonly rangeStartMs: number;
  readonly rangeEndMs: number;
}

export function parseConfigTimeRange(config: QuantlabConfig): QuantlabTimeBounds {
  const start = dayjs(config.start, TIME_FMT, true);
  const end = dayjs(config.end, TIME_FMT, true);
  if (!start.isValid()) {
    throw new Error(`Invalid quantlab start time: ${config.start} (expected ${TIME_FMT})`);
  }
  if (!end.isValid()) {
    throw new Error(`Invalid quantlab end time: ${config.end} (expected ${TIME_FMT})`);
  }
  return {
    rangeStartMs: start.valueOf(),
    rangeEndMs: end.valueOf(),
  };
}

function assertQuantlabConfig(raw: unknown): asserts raw is QuantlabConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Quantlab config must export a default object');
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.symbols) || o.symbols.length === 0 || !o.symbols.every((s) => typeof s === 'string')) {
    throw new Error('quantlab.config: symbols must be a non-empty string array');
  }
  for (const key of ['interval', 'start', 'end', 'category', 'strategy'] as const) {
    if (typeof o[key] !== 'string' || (o[key] as string).length === 0) {
      throw new Error(`quantlab.config: "${key}" must be a non-empty string`);
    }
  }
  if (typeof o.capital !== 'number' || !Number.isFinite(o.capital)) {
    throw new Error('quantlab.config: capital must be a finite number');
  }
  if (typeof o.feeRate !== 'number' || !Number.isFinite(o.feeRate)) {
    throw new Error('quantlab.config: feeRate must be a finite number');
  }
  const cat = o.category as string;
  if (cat !== 'linear' && cat !== 'spot' && cat !== 'inverse') {
    throw new Error('quantlab.config: category must be linear | spot | inverse');
  }
}

/**
 * Load default export from a quantlab config file (ESM).
 * @param configPath Absolute or cwd-relative path to `quantlab.config.js` (or `.ts` via loader).
 */
export async function loadQuantlabConfig(configPath: string): Promise<QuantlabConfig> {
  const abs = resolve(configPath);
  const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
  const raw = mod.default;
  assertQuantlabConfig(raw);
  parseConfigTimeRange(raw);
  return raw;
}
