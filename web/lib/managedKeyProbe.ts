import { AsyncResultGeneration } from './asyncResultGeneration.ts';

export { AsyncResultGeneration };

export interface ManagedKeyProbeResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

interface ManagedKeyProbeOptions {
  generation: AsyncResultGeneration;
  test: () => Promise<ManagedKeyProbeResult>;
  save?: () => Promise<boolean>;
  onStart: () => void;
  onResult: (result: ManagedKeyProbeResult) => void;
  onSaved?: () => void;
  onVerified?: () => void;
  onError: (error: unknown) => void;
  onFinish: () => void;
}

/**
 * Owns one managed-secret probe from request through optional persistence.
 * Every state-changing callback is gated by the generation captured at start,
 * so a provider switch or replacement edit can invalidate the whole result.
 */
export async function runManagedKeyProbe(options: ManagedKeyProbeOptions): Promise<void> {
  const generation = options.generation.begin();
  options.onStart();
  try {
    const result = await options.test();
    if (!options.generation.isCurrent(generation)) return;
    options.onResult(result);
    if (!result.ok) return;

    if (!options.save) {
      options.onVerified?.();
      return;
    }

    const saved = await options.save();
    if (saved && options.generation.isCurrent(generation)) options.onSaved?.();
  } catch (error) {
    if (options.generation.isCurrent(generation)) options.onError(error);
  } finally {
    if (options.generation.isCurrent(generation)) options.onFinish();
  }
}
