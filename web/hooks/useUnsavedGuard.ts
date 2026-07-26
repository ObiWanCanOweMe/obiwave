'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  installUnsavedNavigationGuard,
  requestGuardedNavigation,
  type GuardedNavigationIntent,
  UnsavedHistoryBarrier,
  UnsavedHistoryBarrierLifecycle,
} from '../lib/guardedNavigation';

/**
 * Protects a locally edited admin screen from every client-side exit:
 * anchors, shared programmatic navigation, and browser Back. Reloads and
 * off-origin exits retain the browser's native beforeunload prompt.
 */
export function useUnsavedGuard(
  active: boolean,
  onNavigate: (intent: GuardedNavigationIntent) => void,
): void {
  const router = useRouter();
  const cb = useRef(onNavigate);
  const lifecycleRef = useRef<UnsavedHistoryBarrierLifecycle | null>(null);
  lifecycleRef.current ??= new UnsavedHistoryBarrierLifecycle();
  cb.current = onNavigate;

  useEffect(() => {
    if (!active) return;

    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const lease = lifecycleRef.current!.acquire(
      () => new UnsavedHistoryBarrier(window.history, currentHref, {
        events: {
          add: listener => window.addEventListener('popstate', listener),
          remove: listener => window.removeEventListener('popstate', listener),
        },
        onGuardedBack: () => {
          requestGuardedNavigation({
            kind: 'back',
            currentHref,
            proceed: () => {},
          });
        },
      }),
    );
    const barrier = lease.barrier;
    const removeGuard = installUnsavedNavigationGuard(barrier, intent => cb.current(intent));

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const a = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      const href = `${url.pathname}${url.search}${url.hash}`;
      requestGuardedNavigation({
        kind: 'push',
        href,
        currentHref,
        proceed: () => router.push(href),
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      removeGuard();
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      lease.release();
    };
  }, [active, router]);
}
