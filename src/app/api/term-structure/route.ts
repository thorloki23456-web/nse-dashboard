import { NextRequest, NextResponse } from 'next/server';
import {
  buildOptionChainUrl,
  createNseSession,
  getCachedRouteResponse,
  getNseCookies,
  getNseRequestConfig,
  getUpstreamFailureStatus,
  type RouteCache,
  setCachedRouteResponse,
  withExponentialBackoff,
} from '@/lib/server/nse';
import { buildExpiryComparisonSnapshot, runTermStructureEngine } from '@/lib/termStructureEngine';
import type { TermStructureRouteResponse } from '@/lib/termStructure.types';
import type { OptionChain, OptionStrike } from '@/lib/types';

const termStructureCache: RouteCache<TermStructureRouteResponse> = new Map();

function createEmptyResponse(
  symbol: string,
  currentExpiryDate: string | null,
  nextExpiryDate: string | null,
  error: string
): TermStructureRouteResponse {
  return {
    symbol,
    currentExpiryDate,
    nextExpiryDate,
    snapshot: null,
    result: null,
    error,
  };
}

async function fetchExpiryDates(session: ReturnType<typeof createNseSession>, symbol: string) {
  const url = `https://www.nseindia.com/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`;

  return withExponentialBackoff(async () => {
    const cookies = await getNseCookies(session);
    const response = await session.get(url, getNseRequestConfig(cookies));
    const data = response.data;
    const expiryDates = data.expiryDates ?? data.records?.expiryDates ?? [];

    return Array.isArray(expiryDates)
      ? expiryDates.filter((expiry): expiry is string => typeof expiry === 'string' && expiry.length > 0)
      : [];
  });
}

async function fetchOptionChain(
  session: ReturnType<typeof createNseSession>,
  symbol: string,
  expiryDate: string
): Promise<OptionChain> {
  const url = buildOptionChainUrl(symbol, expiryDate);

  return withExponentialBackoff(async () => {
    const cookies = await getNseCookies(session);
    const response = await session.get(url, getNseRequestConfig(cookies));
    const data = response.data;
    const strikes = Array.isArray(data.records?.data) ? (data.records.data as OptionStrike[]) : [];

    return {
      symbol,
      expiryDate,
      timestamp: typeof data.records?.timestamp === 'string' ? data.records.timestamp : '',
      underlyingValue:
        typeof data.records?.underlyingValue === 'number' ? data.records.underlyingValue : 0,
      data: strikes,
    };
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const cacheKey = request.url;
  const cached = getCachedRouteResponse(termStructureCache, cacheKey);

  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const session = createNseSession();

  try {
    const expiryDates = await fetchExpiryDates(session, symbol);

    if (expiryDates.length < 2) {
      return NextResponse.json(
        createEmptyResponse(symbol, expiryDates[0] ?? null, expiryDates[1] ?? null, 'At least two expiries are required for term structure analysis'),
        { status: 400 }
      );
    }

    const currentExpiryDate = expiryDates[0];
    const nextExpiryDate = expiryDates[1];
    const [currentWeekResult, nextWeekResult] = await Promise.allSettled([
      fetchOptionChain(session, symbol, currentExpiryDate),
      fetchOptionChain(session, symbol, nextExpiryDate),
    ]);

    if (currentWeekResult.status !== 'fulfilled' || nextWeekResult.status !== 'fulfilled') {
      return NextResponse.json(
        createEmptyResponse(
          symbol,
          currentExpiryDate,
          nextExpiryDate,
          'Failed to fetch one or more option-chain payloads for weekly term structure'
        ),
        { status: getUpstreamFailureStatus() }
      );
    }

    const currentWeekChain = currentWeekResult.value;
    const nextWeekChain = nextWeekResult.value;
    const spot =
      currentWeekChain.underlyingValue > 0
        ? currentWeekChain.underlyingValue
        : nextWeekChain.underlyingValue;
    const snapshot = buildExpiryComparisonSnapshot(
      currentWeekChain,
      nextWeekChain,
      spot,
      currentExpiryDate,
      nextExpiryDate
    );
    const payload: TermStructureRouteResponse = {
      symbol,
      currentExpiryDate,
      nextExpiryDate,
      snapshot,
      result: runTermStructureEngine(snapshot),
      error: null,
    };

    setCachedRouteResponse(termStructureCache, cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to build term structure:', error);
    return NextResponse.json(
      createEmptyResponse(symbol, null, null, 'Failed to build term structure'),
      { status: getUpstreamFailureStatus() }
    );
  }
}
