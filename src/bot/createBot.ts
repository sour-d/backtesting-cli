import type { RunMode } from '../core/mode.js';
import { Bot, type BotDeps } from './Bot.js';

export function createBot(mode: RunMode, deps: BotDeps): Bot {
  switch (mode) {
    case 'live':
      return new Bot(deps);
    case 'paper':
      throw new Error('createBot: mode "paper" is not implemented yet');
    case 'backtest':
      return new Bot(deps);
    default: {
      const _e: never = mode;
      return _e;
    }
  }
}
