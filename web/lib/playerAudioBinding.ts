// Callback-ref lifecycle seam for the player's conditionally mounted <audio>
// element. React calls the ref with null before a replacement node; keeping the
// ordering explicit also makes the detach/rebind behavior independently
// testable without a browser DOM.
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
