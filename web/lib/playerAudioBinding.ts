// Callback-ref lifecycle seam for the player's conditionally mounted <audio>
// element. React calls the ref with null before a replacement node; keeping the
// ordering explicit also makes the detach/rebind behavior independently
// testable without a browser DOM.
export type PlayerPlaybackStatus = 'idle' | 'connecting' | 'playing';
export type PlayerAudioEvent = 'playing' | 'waiting' | 'stalled' | 'timeupdate' | 'error';

export interface PlayerAudioProgress {
  paused: boolean;
  readyState: number;
  currentTime: number;
}

export function playerAudioIsAdvancing(
  element: PlayerAudioProgress,
  since: number,
): boolean {
  return !element.paused && element.readyState >= 3 && element.currentTime > since;
}

export function playerStatusAfterAudioEvent(
  current: PlayerPlaybackStatus,
  event: PlayerAudioEvent,
  element: PlayerAudioProgress,
): PlayerPlaybackStatus {
  if (event === 'error') return 'idle';
  if (event === 'playing') return 'playing';
  if (event === 'waiting') return current === 'playing' ? 'connecting' : current;
  if (event === 'timeupdate' && playerAudioIsAdvancing(element, -Infinity)) {
    return current === 'connecting' ? 'playing' : current;
  }
  return current;
}

export function bindPlayerAudioEvents(
  element: Pick<HTMLAudioElement, 'addEventListener' | 'removeEventListener'>,
  handlers: Record<PlayerAudioEvent, EventListener>,
): () => void {
  for (const event of ['playing', 'waiting', 'stalled', 'timeupdate', 'error'] as const) {
    element.addEventListener(event, handlers[event]);
  }
  return () => {
    for (const event of ['playing', 'waiting', 'stalled', 'timeupdate', 'error'] as const) {
      element.removeEventListener(event, handlers[event]);
    }
  };
}

export function replacePlayerAudioElement<T>(
  elementRef: { current: T | null },
  cleanupRef: { current: (() => void) | null },
  next: T | null,
  bind: (element: T) => () => void,
): void {
  cleanupRef.current?.();
  cleanupRef.current = null;
  elementRef.current = next;
  if (next) cleanupRef.current = bind(next);
}

export function teardownDetachedPlayerAudio(
  element: { pause: () => void; src: string },
  resetPlayback: () => void,
): void {
  resetPlayback();
  element.pause();
  element.src = '';
}
