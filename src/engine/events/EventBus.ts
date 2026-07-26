import type { ILogger } from '../../logger/ILogger.js';
import type { EngineEvent } from './types.js';

export type EngineEventListener = (event: EngineEvent) => void | Promise<void>;

export class EventBus {
  private readonly listeners = new Map<EngineEvent['type'], EngineEventListener[]>();

  constructor(private readonly logger: ILogger) {}

  on(type: EngineEvent['type'], listener: EngineEventListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  async publish(event: EngineEvent): Promise<void> {
    const list = this.listeners.get(event.type) ?? [];
    for (const listener of list) {
      try {
        await listener(event);
      } catch (e) {
        this.logger.error('DEBUG:: EventBus listener failed', {
          type: event.type,
          message: String(e),
        });
      }
    }
  }
}
