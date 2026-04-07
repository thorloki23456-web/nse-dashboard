/**
 * Lightweight in-browser LRU-style cache with TTL.
 * Keyed by string; values are typed generics.
 * No external dependencies.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BrowserCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 15_000, maxSize = 50) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxSize) {
      // Evict oldest entry
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Singleton caches shared across the app */
export const optionChainCache = new BrowserCache<unknown>(15_000);
export const technicalCache = new BrowserCache<unknown>(30_000);
