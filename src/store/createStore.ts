import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RunMode } from '../core/types.js';
import type { IStore } from './IStore.js';
import { FileStore } from './FileStore.js';
import { SupabaseStore } from './SupabaseStore.js';

export interface CreateStoreOptions {
  baseDir?: string;
  /** For mode 'live': use Supabase if both are set */
  supabaseUrl?: string;
  supabaseKey?: string;
  /** If true, clean file-based live data (deployments, positions, trades) before use */
  cleanLiveData?: boolean;
}

/**
 * Create store for the given mode. One entry point: same interface, behavior by mode.
 * - backtest: FileStore (read/write market, results, stats)
 * - paper: FileStore (optional cleanLiveData)
 * - live: SupabaseStore if SUPABASE_URL/KEY set; else FileStore
 */
export function createStore(mode: RunMode, options: CreateStoreOptions = {}): IStore {
  const { baseDir = '.data', supabaseUrl, supabaseKey, cleanLiveData } = options;

  if (mode === 'live' && supabaseUrl && supabaseKey) {
    const client = createClient(supabaseUrl, supabaseKey);
    return new SupabaseStore(client);
  }

  const fileStore = new FileStore(baseDir);
  if (cleanLiveData) {
    fileStore.cleanLiveData();
  }
  return fileStore;
}
