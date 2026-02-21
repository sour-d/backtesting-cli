import { pathToFileURL } from 'node:url';
import path from 'node:path';
import dayjs from 'dayjs';

const CONFIG_FILENAME = 'quantlab.config.js';

export interface QuantlabConfig {
  readonly symbols?: string[];
  readonly interval?: string;
  readonly start?: string;
  readonly end?: string;
  readonly category?: 'linear' | 'spot' | 'inverse';
  readonly strategy?: string;
  readonly capital?: number;
  readonly riskPercentage?: number;
  readonly maxAllocation?: number;
  readonly feeRate?: number;
}

export async function loadConfig(cwd = process.cwd()): Promise<QuantlabConfig> {
  const filePath = path.resolve(cwd, CONFIG_FILENAME);
  try {
    const mod = await import(pathToFileURL(filePath).href) as { default: QuantlabConfig };
    return mod.default;
  } catch {
    return {};
  }
}

/**
 * Parse a date string (e.g. "2024-01-01", "2024-06-15 12:00") into unix ms.
 * Also accepts raw numeric strings for backward compatibility.
 */
export function parseDate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const asNum = Number(value);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000_000) return asNum;

  const parsed = dayjs(value);
  if (!parsed.isValid()) return undefined;
  return parsed.valueOf();
}
