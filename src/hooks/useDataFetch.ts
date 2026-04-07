'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserCache } from '@/lib/cache';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const globalCache = new BrowserCache<unknown>(15_000, 100);

/**
 * Generic data-fetch hook with in-browser TTL cache and periodic refresh.
 */
export function useDataFetch<T>(
  url: string | null,
  options: { refreshMs?: number; enabled?: boolean } = {}
): FetchState<T> & { refresh: () => void } {
  const { refreshMs = 15_000, enabled = true } = options;
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: false,
    error: null,
    lastUpdated: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!url || !enabled) return;

    const cached = globalCache.get(url) as T | null;
    if (cached) {
      setState((prev) => ({ ...prev, data: cached, loading: false, error: null }));
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(url, { signal: abortRef.current.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      globalCache.set(url, json);
      setState({ data: json, loading: false, error: null, lastUpdated: Date.now() });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: (err as Error).message ?? 'Fetch failed',
      }));
    }
  }, [url, enabled]);

  useEffect(() => {
    fetchData();
    if (!refreshMs) return;
    const id = setInterval(fetchData, refreshMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchData, refreshMs]);

  return { ...state, refresh: fetchData };
}
