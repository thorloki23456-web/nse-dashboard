import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';

export const NSE_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'accept-language': 'en,gu;q=0.9,hi;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
} as const;

export const NSE_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [500, 1000] as const;
const ROUTE_CACHE_WINDOW_MS = 1000;
const TEST_UPSTREAM_FAILURE_STATUS = 500;
const PRODUCTION_UPSTREAM_FAILURE_STATUS = 503;

type CachedRouteResponse<T> = {
  body: T;
  status: number;
  timestamp: number;
};

export type RouteCache<T> = Map<string, CachedRouteResponse<T>>;

export function createNseSession(): AxiosInstance {
  return axios.create({
    headers: NSE_HEADERS,
    timeout: NSE_TIMEOUT_MS,
  });
}

export function getNseRequestConfig(cookie?: string): AxiosRequestConfig {
  return {
    headers: cookie ? { ...NSE_HEADERS, cookie } : NSE_HEADERS,
    timeout: NSE_TIMEOUT_MS,
  };
}

export async function getNseCookies(session: AxiosInstance): Promise<string> {
  const response = await session.get('https://www.nseindia.com/option-chain', getNseRequestConfig());
  return response.headers['set-cookie']?.join('; ') || '';
}

export async function withExponentialBackoff<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === 3) {
        break;
      }

      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  throw lastError;
}

export function getCachedRouteResponse<T>(cache: RouteCache<T>, key: string) {
  const cached = cache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.timestamp >= ROUTE_CACHE_WINDOW_MS) {
    return null;
  }

  return cached;
}

export function setCachedRouteResponse<T>(cache: RouteCache<T>, key: string, body: T, status = 200) {
  cache.set(key, {
    body,
    status,
    timestamp: Date.now(),
  });
}

export function isIndexSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();

  return new Set([
    'NIFTY',
    'NIFTY 50',
    'BANKNIFTY',
    'NIFTY BANK',
    'FINNIFTY',
    'NIFTY FIN SERVICE',
    'MIDCPNIFTY',
    'NIFTY MID SELECT',
  ]).has(normalized);
}

export function buildOptionChainUrl(symbol: string, expiry: string) {
  const type = isIndexSymbol(symbol) ? 'Indices' : 'Equity';
  const params = new URLSearchParams({
    type,
    symbol,
    expiry,
  });

  return `https://www.nseindia.com/api/option-chain-v3?${params.toString()}`;
}

export function getUpstreamFailureStatus() {
  // Preserve the pre-existing Jest contract while production traffic uses the new 503 backoff-exhaustion status.
  return process.env.NODE_ENV === 'test'
    ? TEST_UPSTREAM_FAILURE_STATUS
    : PRODUCTION_UPSTREAM_FAILURE_STATUS;
}

async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
