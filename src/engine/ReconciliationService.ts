import type { IBroker } from '../broker/IBroker.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IPositionBook } from '../position/IPositionBook.js';
import type { IStore } from '../store/IStore.js';

/**
 * Live venue reconcile tick — implemented by {@link PositionManager#reconcileTrackedSymbolsFromVenue}.
 */
export type ReconciliationPositionService = IPositionBook & {
  reconcileTrackedSymbolsFromVenue(): Promise<void>;
};

/**
 * Single periodic loop: sync tracked symbols from the venue, then align DB/registry
 * via {@link PositionManager#reconcileTrackedSymbolsFromVenue} (sync + reconcileMissingRowIfNeeded + applyRegistryAfterVenueSync).
 */
export class ReconciliationService {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly broker: IBroker,
    private readonly positionService: ReconciliationPositionService,
    private readonly store: IStore,
    private readonly logger: ILogger,
  ) {}

  start(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer) return;
    if (typeof this.broker.syncPositionFromVenue !== 'function') {
      this.logger.warn('DEBUG:: ReconciliationService not started — broker has no syncPositionFromVenue', {});
      return;
    }
    this.timer = setInterval(() => {
      void this.positionService.reconcileTrackedSymbolsFromVenue();
    }, intervalMs);
    this.logger.info('DEBUG:: ReconciliationService started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info('DEBUG:: ReconciliationService stopped', {});
  }
}
