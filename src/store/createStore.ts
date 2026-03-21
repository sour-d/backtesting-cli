import type { RunMode } from '../core/mode.js';
import { FileStore } from './FileStore.js';
import type { IStore } from './IStore.js';

export interface CreateStoreConfig {
  readonly mode: RunMode;
  readonly baseDir?: string;
}

/**
 * Persistence factory — today only file-backed store for live mode.
 * Future: Supabase / in-memory for tests without changing call sites.
 */
export function createStore(config: CreateStoreConfig): IStore {
  switch (config.mode) {
    case 'live':
      return new FileStore(config.baseDir ?? '.data');
    case 'paper':
      throw new Error('createStore: mode "paper" is not implemented yet');
    case 'backtest':
      throw new Error('createStore: mode "backtest" is not implemented yet');
    default: {
      const _exhaustive: never = config.mode;
      return _exhaustive;
    }
  }
}
