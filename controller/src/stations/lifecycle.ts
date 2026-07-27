// Process-local station mutation lifecycle. Every station mutation owns the
// single lease while it runs. Pointer-moving outcomes promote the lease to
// `switching`, which intentionally has no release path: the boot-bound
// settings/library handles are stale until this process exits.

export type StationMutationState = 'idle' | 'mutating' | 'switching';

export class StationMutationConflictError extends Error {
  readonly switching: boolean;

  constructor(blockingState: Exclude<StationMutationState, 'idle'>) {
    const switching = blockingState === 'switching';
    super(switching ? 'station switch in progress' : 'station mutation in progress');
    this.name = 'StationMutationConflictError';
    this.switching = switching;
  }
}

export interface StationSwitchPolicy<T> {
  switchOnResult?: (result: T) => boolean;
  switchOnError?: (error: unknown) => boolean;
}

export interface StationMutationGuard {
  run<T>(
    operation: () => T | Promise<T>,
    policy?: StationSwitchPolicy<T>,
  ): Promise<T>;
  state(): StationMutationState;
}

export function createStationMutationGuard(): StationMutationGuard {
  let current: StationMutationState = 'idle';

  return {
    async run<T>(
      operation: () => T | Promise<T>,
      policy: StationSwitchPolicy<T> = {},
    ): Promise<T> {
      if (current !== 'idle') throw new StationMutationConflictError(current);
      current = 'mutating';
      try {
        const result = await operation();
        current = policy.switchOnResult?.(result) ? 'switching' : 'idle';
        return result;
      } catch (error) {
        current = policy.switchOnError?.(error) ? 'switching' : 'idle';
        throw error;
      }
    },

    state(): StationMutationState {
      return current;
    },
  };
}

export const stationMutationGuard = createStationMutationGuard();
