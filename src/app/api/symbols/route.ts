import { NextResponse } from 'next/server';
import {
  createNseSession,
  getCachedRouteResponse,
  getNseCookies,
  getNseRequestConfig,
  getUpstreamFailureStatus,
  RouteCache,
  setCachedRouteResponse,
  withExponentialBackoff,
} from '@/lib/server/nse';

const symbolsCache: RouteCache<unknown> = new Map();

export async function GET() {
  const cacheKey = 'symbols';
  const cached = getCachedRouteResponse(symbolsCache, cacheKey);

  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const session = createNseSession();

  try {
    const data = await withExponentialBackoff(async () => {
      const cookies = await getNseCookies(session);
      const response = await session.get(
        'https://www.nseindia.com/api/underlying-information',
        getNseRequestConfig(cookies)
      );

      return response.data;
    });

    setCachedRouteResponse(symbolsCache, cacheKey, data);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch symbols:', error);
    return NextResponse.json({ error: 'Failed to fetch symbols' }, { status: getUpstreamFailureStatus() });
  }
}
