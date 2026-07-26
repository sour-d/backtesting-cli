import type { Bot } from '../bot/Bot.js';
import type { IBroker } from '../broker/IBroker.js';
import type { ILogger } from '../logger/ILogger.js';
import { EventBus } from './events/EventBus.js';
import type { ReconciliationService } from './ReconciliationService.js';

export interface WireEngineEventsResult {
  readonly stopReconcilePublisher?: () => void;
}

export function wireEngineEvents(opts: {
  readonly bus: EventBus;
  readonly bot: Bot;
  readonly reconciliationService: ReconciliationService;
  readonly broker: IBroker;
  readonly reconcileIntervalMs: number;
  readonly logger: ILogger;
}): WireEngineEventsResult {
  opts.bus.on('CandleClosed', async (event) => {
    if (event.type !== 'CandleClosed') return;
    await opts.bot.onCandle(event.instrument);
  });

  opts.bus.on('ReconcileTick', async (event) => {
    if (event.type !== 'ReconcileTick') return;
    await opts.reconciliationService.runScheduledReconcile();
  });

  let stopReconcilePublisher: (() => void) | undefined;
  const intervalMs = opts.reconcileIntervalMs;
  if (intervalMs > 0 && typeof opts.broker.syncPositionFromVenue === 'function') {
    const id = setInterval(() => {
      void opts.bus.publish({ type: 'ReconcileTick' });
    }, intervalMs);
    stopReconcilePublisher = () => clearInterval(id);
    opts.logger.info('DEBUG:: ReconciliationService started', { intervalMs });
  } else if (intervalMs > 0) {
    opts.logger.warn(
      'DEBUG:: ReconciliationService not started — broker has no syncPositionFromVenue',
      {},
    );
  }

  return { stopReconcilePublisher };
}
