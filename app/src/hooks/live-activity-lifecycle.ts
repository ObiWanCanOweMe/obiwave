import type {
  LiveActivityConfig,
  LiveActivityState,
} from '../../modules/live-activity';

/** The narrow native boundary the hook needs to own one Live Activity. */
export interface LiveActivityBridge {
  start(config: LiveActivityConfig, state: LiveActivityState): Promise<boolean>;
  stop(): Promise<void>;
}

// React cleanup and the next effect deliberately overlap in time: start awaits
// native `endAll()`, while cleanup takes the old card down. Keep those commands
// in order and invalidate every previous start before it can report ownership.
// A stale native completion is explicitly ended before the queued cleanup/new
// start proceeds, so it cannot leave an orphaned old-station card behind.
export class LiveActivityLifecycle {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly bridge: LiveActivityBridge) {}

  start(config: LiveActivityConfig, state: LiveActivityState): Promise<boolean> {
    const generation = ++this.generation;
    return this.enqueue(async () => {
      if (!this.owns(generation)) return false;

      let started = false;
      try {
        started = await this.bridge.start(config, state);
      } catch {
        return false;
      }
      if (!started) return false;

      if (this.owns(generation)) return true;
      await this.endIgnoringErrors();
      return false;
    });
  }

  stop(): Promise<void> {
    ++this.generation;
    return this.enqueue(async () => {
      await this.endIgnoringErrors();
    });
  }

  private owns(generation: number): boolean {
    return this.generation === generation;
  }

  private async endIgnoringErrors(): Promise<void> {
    try {
      await this.bridge.stop();
    } catch {
      // A card is auxiliary. Most importantly, one native error must not leave
      // the command queue wedged before a later tune-in can make the real card.
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
