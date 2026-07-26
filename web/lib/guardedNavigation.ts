export interface GuardedNavigationIntent {
  kind: 'push' | 'back';
  href?: string;
  currentHref?: string;
  proceed: () => void;
}

type NavigationGuard = (intent: GuardedNavigationIntent) => void;

interface NavigationHistory {
  readonly state: unknown;
  pushState(state: unknown, unused: string, href: string): void;
  back(): void;
  go(delta: number): void;
}

interface PopStateEvents {
  add(listener: () => void): void;
  remove(listener: () => void): void;
}

interface UnsavedHistoryBarrierOptions {
  marker?: string;
  events?: PopStateEvents;
  onGuardedBack?: () => void;
}

interface UnsavedHistoryBarrierDisposal {
  shouldRearm?: () => boolean;
  onInactive?: () => void;
}

type BarrierMode = 'guarding' | 'leaving-push' | 'leaving-back' | 'disposing' | 'inactive';

const HISTORY_MARKER = '__subwaveUnsavedGuard';
let activeGuard: NavigationGuard | null = null;

function routeKey(href: string): string {
  const url = new URL(href, 'http://subwave.local');
  return `${url.pathname}${url.search}`;
}

function isCurrentRoute(intent: GuardedNavigationIntent): boolean {
  return intent.kind === 'push'
    && !!intent.href
    && !!intent.currentHref
    && routeKey(intent.href) === routeKey(intent.currentHref);
}

/** Install the one active unsaved-work guard in the admin client. */
export function installNavigationGuard(guard: NavigationGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/**
 * Owns the duplicate current-route entry used to intercept browser Back.
 * Different-route pushes first step off that duplicate, then navigate from the
 * real current entry so the barrier cannot survive in browser history.
 */
export class UnsavedHistoryBarrier {
  private mode: BarrierMode = 'guarding';
  private pendingPush: (() => void) | null = null;
  private readonly history: NavigationHistory;
  private readonly currentHref: string;
  private readonly marker: string;
  private readonly events: PopStateEvents | null;
  private readonly onGuardedBack: () => void;
  private listenerAttached = false;
  private disposal: UnsavedHistoryBarrierDisposal | null = null;
  private readonly onPopState = () => this.handlePopState(this.onGuardedBack);

  constructor(
    history: NavigationHistory,
    currentHref: string,
    markerOrOptions: string | UnsavedHistoryBarrierOptions = {},
  ) {
    this.history = history;
    this.currentHref = currentHref;
    const options = typeof markerOrOptions === 'string'
      ? { marker: markerOrOptions }
      : markerOrOptions;
    this.marker = options.marker ?? `${Date.now()}-${Math.random()}`;
    this.events = options.events ?? null;
    this.onGuardedBack = options.onGuardedBack ?? (() => {});
    if (this.events) {
      this.events.add(this.onPopState);
      this.listenerAttached = true;
    }
    this.push();
  }

  private push(): void {
    const baseState = this.history.state && typeof this.history.state === 'object'
      ? this.history.state
      : {};
    this.history.pushState(
      { ...baseState, [HISTORY_MARKER]: this.marker },
      '',
      this.currentHref,
    );
  }

  /**
   * A user Back restores the barrier and asks for a leave decision; an
   * internal cleanup Back resumes its held push. The barrier owns this
   * listener so React effect cleanup cannot strand an in-flight transition.
   */
  handlePopState(onGuardedBack: () => void): void {
    if (this.mode === 'leaving-push') {
      const pendingPush = this.pendingPush;
      this.pendingPush = null;
      this.mode = 'inactive';
      this.detachListener();
      pendingPush?.();
      return;
    }
    if (this.mode === 'disposing') {
      const disposal = this.disposal;
      this.disposal = null;
      if (disposal?.shouldRearm?.()) {
        this.mode = 'guarding';
        this.push();
        return;
      }
      this.mode = 'inactive';
      this.detachListener();
      disposal?.onInactive?.();
      return;
    }
    if (this.mode === 'leaving-back') {
      this.mode = 'inactive';
      this.detachListener();
      return;
    }
    if (this.mode !== 'guarding') return;

    this.push();
    onGuardedBack();
  }

  private detachListener(): void {
    if (!this.events || !this.listenerAttached) return;
    this.events.remove(this.onPopState);
    this.listenerAttached = false;
  }

  proceed(intent: GuardedNavigationIntent): void {
    if (this.mode !== 'guarding') return;
    if (intent.kind === 'back') {
      this.mode = 'leaving-back';
      this.history.go(-2);
      return;
    }

    this.mode = 'leaving-push';
    this.pendingPush = intent.proceed;
    this.history.back();
  }

  /** Whether a new effect lease can safely retain this barrier instance. */
  isReusable(): boolean {
    return this.mode !== 'inactive';
  }

  /** Remove the barrier after a normal save that leaves this route mounted. */
  dispose(disposal: UnsavedHistoryBarrierDisposal = {}): void {
    if (this.mode !== 'guarding') return;
    this.mode = 'disposing';
    this.disposal = disposal;
    this.history.back();
  }
}

interface UnsavedHistoryBarrierLease {
  readonly barrier: UnsavedHistoryBarrier;
  release(): void;
}

type DeferBarrierDisposal = (callback: () => void) => void;

/**
 * Keeps one barrier across effect replacement while ensuring an unclaimed
 * barrier is disposed after genuine unmount. Disposal remains mode-aware:
 * an in-flight transition keeps its owned listener until popstate completes.
 */
export class UnsavedHistoryBarrierLifecycle {
  private barrier: UnsavedHistoryBarrier | null = null;
  private generation = 0;
  private claimedGeneration: number | null = null;
  private readonly deferDisposal: DeferBarrierDisposal;

  constructor(
    deferDisposal: DeferBarrierDisposal = callback => { setTimeout(callback, 0); },
  ) {
    this.deferDisposal = deferDisposal;
  }

  acquire(createBarrier: () => UnsavedHistoryBarrier): UnsavedHistoryBarrierLease {
    const generation = ++this.generation;
    this.claimedGeneration = generation;
    const barrier = this.barrier?.isReusable()
      ? this.barrier
      : createBarrier();
    this.barrier = barrier;
    let released = false;

    return {
      barrier,
      release: () => {
        if (released) return;
        released = true;
        this.deferDisposal(() => {
          if (this.generation !== generation || this.barrier !== barrier) return;
          this.claimedGeneration = null;
          barrier.dispose({
            shouldRearm: () => (
              this.barrier === barrier
              && this.claimedGeneration !== null
            ),
            onInactive: () => {
              if (this.barrier === barrier && this.claimedGeneration === null) {
                this.barrier = null;
              }
            },
          });
        });
      },
    };
  }
}

/**
 * Couples the global guard to its history lifecycle. The guard is removed only
 * when a real held navigation proceeds; current-route no-ops never reach it.
 */
export function installUnsavedNavigationGuard(
  barrier: UnsavedHistoryBarrier,
  onNavigate: NavigationGuard,
): () => void {
  let removeGuard = () => {};
  removeGuard = installNavigationGuard(intent => {
    onNavigate({
      ...intent,
      proceed: () => {
        removeGuard();
        barrier.proceed(intent);
      },
    });
  });
  return removeGuard;
}

/**
 * The single entry point for link, command-menu, and browser-history exits.
 * Returns true when no leave decision is required. A current-route push is a
 * settled no-op: it neither calls the router nor touches the active guard.
 */
export function requestGuardedNavigation(intent: GuardedNavigationIntent): boolean {
  if (isCurrentRoute(intent)) return true;
  if (activeGuard) {
    activeGuard(intent);
    return false;
  }
  intent.proceed();
  return true;
}
