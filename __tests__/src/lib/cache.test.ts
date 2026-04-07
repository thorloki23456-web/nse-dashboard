import { BrowserCache } from '@/lib/cache';

describe('BrowserCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores and retrieves a value within TTL', () => {
    const cache = new BrowserCache<string>(5000);
    cache.set('key1', 'hello');
    expect(cache.get('key1')).toBe('hello');
  });

  it('returns null after TTL expires', () => {
    const cache = new BrowserCache<string>(1000);
    cache.set('key1', 'hello');
    jest.advanceTimersByTime(1001);
    expect(cache.get('key1')).toBeNull();
  });

  it('returns null for missing key', () => {
    const cache = new BrowserCache<string>(5000);
    expect(cache.get('missing')).toBeNull();
  });

  it('evicts oldest entry when maxSize is reached', () => {
    const cache = new BrowserCache<number>(5000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a'
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('invalidate removes a specific key', () => {
    const cache = new BrowserCache<string>(5000);
    cache.set('x', 'val');
    cache.invalidate('x');
    expect(cache.get('x')).toBeNull();
  });

  it('clear removes all entries', () => {
    const cache = new BrowserCache<string>(5000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });
});
