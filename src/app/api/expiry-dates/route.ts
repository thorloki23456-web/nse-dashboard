import { NextRequest, NextResponse } from 'next/server';
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

const expiryDatesCache: RouteCache<{ expiryDates: string[] }> = new Map();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const cacheKey = request.url;
  const cached = getCachedRouteResponse(expiryDatesCache, cacheKey);

  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const session = createNseSession();
  const url = `https://www.nseindia.com/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`;

  try {
    const payload = await withExponentialBackoff(async () => {
      const cookies = await getNseCookies(session);
      const response = await session.get(url, getNseRequestConfig(cookies));
      const data = response.data;

      return {
        expiryDates: data.expiryDates || data.records?.expiryDates || [],
      };
    });

    setCachedRouteResponse(expiryDatesCache, cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to fetch expiry dates:', error);
    return NextResponse.json({ error: 'Failed to fetch expiry dates' }, { status: getUpstreamFailureStatus() });
  }
}
