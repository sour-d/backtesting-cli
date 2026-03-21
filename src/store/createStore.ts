import type { RunMode } from '../core/mode.js';
import { BacktestStore } from './BacktestStore.js';
import { FileStore } from './FileStore.js';
import type { IStore } from './IStore.js';
import { SupabaseStore } from './SupabaseStore.js';

export interface CreateStoreConfig {
  readonly mode: RunMode;
  readonly baseDir?: string;
  readonly supabaseUrl?: string;
  readonly supabaseKey?: string;
}

/**
 * Persistence factory: live → Supabase; paper → file under `.data/paper/`; backtest → file under `.data/…`.
 */
export function createStore(config: CreateStoreConfig): IStore {
  switch (config.mode) {
    case 'live': {
      const url = config.supabaseUrl;
      const key = config.supabaseKey;
      if (!url || !key) {
        throw new Error('createStore(live): supabaseUrl and supabaseKey are required');
      }
      return new SupabaseStore(url, key);
    }
    case 'paper':
      return new FileStore(config.baseDir ?? '.data', 'paper');
    case 'backtest':
      return new BacktestStore(config.baseDir ?? '.data');
    default: {
      const _exhaustive: never = config.mode;
      return _exhaustive;
    }
  }
}
