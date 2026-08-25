'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLibrary } from '../LibraryContext';
import { libraryKeys } from '../queries';
import { adminJson, useQueryErrorToast } from '../../../../lib/admin-query';
import { useAdminQuery } from '../useAdminQuery';
import type { LikedResponse, LikedSort, Track, UntaggedResponse } from '../types';
import { PAGE_SIZE } from '../types';
import { clampLibraryPage } from '../../libraryState';

// One hook per Tracks mode. All three are CALLED unconditionally — hooks cannot
// be conditional — and `enabled` gates the fetch, exactly as the old
// `if (tab !== 'tracks' || trackMode !== …) return` effect guards did, which is
// also the shape TanStack Query's own `enabled` option takes.
//
// The three still disagree about what the shared cross-list events mean, but
// that disagreement now lives in queries.ts (applyTagEvent drops a newly tagged
// row from Needs-tags, applyLikeChange drops a zero-like row from Liked) rather
// than in three hand-written RowSource implementations.

export function useRecentTracks(enabled: boolean) {
  const q = useAdminQuery<Track[]>({
    key: libraryKeys.recent(),
    path: '/dj/recent?limit=50',
    enabled,
    toastOnError: true,
    parse: raw => (raw as { results?: Track[] }).results || [],
  });
  return {
    rows: q.data ?? null,
    loading: q.isFetching,
    reload: () => { void q.refetch(); },
  };
}

export function useUntaggedTracks(enabled: boolean) {
  const { adminFetch, ready } = useLibrary();
  // Cursor paging, unlike Liked's offset pager: /library/untagged hands back a
  // nextCursor and has no cheap total.
  const q = useInfiniteQuery<UntaggedResponse>({
    queryKey: libraryKeys.untagged(),
    enabled: enabled && ready,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam as string);
      return adminJson<UntaggedResponse>(
        adminFetch, `/library/untagged?${params}`, undefined, signal,
      );
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
  useQueryErrorToast(q.error, true);

  const rows = useMemo(() => q.data?.pages.flatMap(p => p.rows) ?? [], [q.data]);
  return {
    rows,
    loading: q.isFetching,
    hasMore: !!q.hasNextPage,
    loadMore: () => { void q.fetchNextPage(); },
  };
}

export function useLikedTracks(enabled: boolean) {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [sort, setSortState] = useState<LikedSort>('recent');
  // Reset paging in the same event as the sort change. An effect would first
  // render (and fetch) the new sort at the old offset, briefly giving that
  // superseded request ownership of a cache key it should never have used.
  const setSort = useCallback((next: LikedSort) => {
    setPage(0);
    setSortState(next);
  }, []);

  const q = useAdminQuery<LikedResponse>({
    key: libraryKeys.liked(sort, page),
    path: () => `/library/liked?${new URLSearchParams({
      limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort,
    })}`,
    enabled,
    toastOnError: true,
    parse: raw => {
      const j = raw as { rows?: Track[]; total?: number };
      return { rows: j.rows || [], total: j.total || 0 };
    },
  });

  // A mutation can shrink the final page out from under the current offset.
  // Wait for this key's response before clamping: during a page transition
  // q.data is temporarily absent and must not be mistaken for an empty list.
  useEffect(() => {
    if (!q.data) return;
    const next = clampLibraryPage(page, q.data.total, PAGE_SIZE);
    if (next === page) return;
    // A valid target page may already be in the 30s cache with the old total.
    // Mark it stale before mounting that key so it refetches rather than
    // stranding the operator on a cached pre-mutation snapshot.
    void qc.invalidateQueries({ queryKey: libraryKeys.liked(sort, next), exact: true });
    setPage(next);
  }, [page, q.data, qc, sort]);

  return {
    rows: q.data?.rows ?? null,
    total: q.data?.total ?? 0,
    loading: q.isFetching,
    page, setPage, sort, setSort,
    reload: () => { void q.refetch(); },
  };
}
