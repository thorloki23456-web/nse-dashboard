import { NextRequest, NextResponse } from 'next/server';
import {
  buildOptionChainUrl,
  createNseSession,
  getCachedRouteResponse,
  getNseCookies,
  getNseRequestConfig,
  getUpstreamFailureStatus,
  RouteCache,
  setCachedRouteResponse,
  withExponentialBackoff,
} from '@/lib/server/nse';

type OptionChainPayload = {
  data: unknown[];
  timestamp: string;
  underlyingValue: number;
};

const optionChainCache: RouteCache<OptionChainPayload> = new Map();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const expiryDate = searchParams.get('expiryDate');

  if (!symbol || !expiryDate) {
    return NextResponse.json({ error: 'Missing symbol or expiryDate' }, { status: 400 });
  }

  const cacheKey = request.url;
  const cached = getCachedRouteResponse(optionChainCache, cacheKey);

  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const session = createNseSession();
  const url = buildOptionChainUrl(symbol, expiryDate);

  try {
    const payload = await withExponentialBackoff(async () => {
      const cookies = await getNseCookies(session);
      const response = await session.get(url, getNseRequestConfig(cookies));
      const data = response.data;

      return {
        data: data.records?.data || [],
        timestamp: data.records?.timestamp || '',
        underlyingValue: data.records?.underlyingValue || 0,
      };
    });

    setCachedRouteResponse(optionChainCache, cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to fetch option chain data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch option chain data' },
      { status: getUpstreamFailureStatus() }
    );
  }
}
