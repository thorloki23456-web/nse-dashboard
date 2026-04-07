import { NextRequest, NextResponse } from 'next/server';
import { Candle, analyzeCandles } from '@/lib/indicators';
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

type TechnicalAnalysisResponse =
  | {
      error: string;
      candles: [];
      analysis: null;
    }
  | {
      symbol: string;
      interval: number;
      candleCount: number;
      currentPrice: number;
      metadata: {
        symbol: string;
        interval: number;
        candleCount: number;
        currentPrice: number;
      };
      analysis: {
        signal: string;
        signalReason: string;
        currentTrend: string;
        currentRSI: number;
        currentATR: number;
        superTrendValue: number;
      };
      recentData: Array<{
        time: string;
        open: number;
        high: number;
        low: number;
        close: number;
        atr: number;
        superTrend: number;
        trend: string;
        rsi: number;
      }>;
    };

const technicalAnalysisCache: RouteCache<TechnicalAnalysisResponse> = new Map();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'NIFTY 50';
  const interval = parseInt(searchParams.get('interval') || '3', 10);
  const stPeriod = parseInt(searchParams.get('stPeriod') || '7', 10);
  const stMultiplier = parseFloat(searchParams.get('stMultiplier') || '2.5');
  const rsiPeriod = parseInt(searchParams.get('rsiPeriod') || '7', 10);

  const cacheKey = request.url;
  const cached = getCachedRouteResponse(technicalAnalysisCache, cacheKey);

  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const indexMap: Record<string, string> = {
    NIFTY: 'NIFTY 50',
    'NIFTY 50': 'NIFTY 50',
    BANKNIFTY: 'NIFTY BANK',
    'NIFTY BANK': 'NIFTY BANK',
    FINNIFTY: 'NIFTY FIN SERVICE',
    'NIFTY FIN SERVICE': 'NIFTY FIN SERVICE',
    MIDCPNIFTY: 'NIFTY MID SELECT',
  };

  const indexSymbol = indexMap[symbol.toUpperCase()] || symbol;
  const session = createNseSession();
  const chartUrl = `https://www.nseindia.com/api/chart-databyindex?index=${encodeURIComponent(indexSymbol)}&preopen=true`;

  try {
    const payload = await withExponentialBackoff(async () => {
      const cookies = await getNseCookies(session);
      const response = await session.get(chartUrl, getNseRequestConfig(cookies));
      const chartData = response.data;

      const ticks: { time: number; price: number }[] = (chartData.gpiData || []).map(
        (item: [number, number]) => ({
          time: item[0],
          price: item[1],
        })
      );

      if (ticks.length === 0) {
        return {
          error: 'No chart data available',
          candles: [],
          analysis: null,
        } satisfies TechnicalAnalysisResponse;
      }

      const intervalMs = interval * 60 * 1000;
      const candles: Candle[] = [];
      let currentBucket = Math.floor(ticks[0].time / intervalMs) * intervalMs;
      let bucketTicks: number[] = [];

      for (const tick of ticks) {
        const tickBucket = Math.floor(tick.time / intervalMs) * intervalMs;

        if (tickBucket !== currentBucket) {
          if (bucketTicks.length > 0) {
            const date = new Date(currentBucket);
            candles.push({
              time: `${date.getHours().toString().padStart(2, '0')}:${date
                .getMinutes()
                .toString()
                .padStart(2, '0')}`,
              open: bucketTicks[0],
              high: Math.max(...bucketTicks),
              low: Math.min(...bucketTicks),
              close: bucketTicks[bucketTicks.length - 1],
            });
          }

          currentBucket = tickBucket;
          bucketTicks = [tick.price];
        } else {
          bucketTicks.push(tick.price);
        }
      }

      if (bucketTicks.length > 0) {
        const date = new Date(currentBucket);
        candles.push({
          time: `${date.getHours().toString().padStart(2, '0')}:${date
            .getMinutes()
            .toString()
            .padStart(2, '0')}`,
          open: bucketTicks[0],
          high: Math.max(...bucketTicks),
          low: Math.min(...bucketTicks),
          close: bucketTicks[bucketTicks.length - 1],
        });
      }

      const analysis = analyzeCandles(candles, stPeriod, stMultiplier, rsiPeriod);
      const currentPrice = ticks[ticks.length - 1].price;
      const metadata = {
        symbol: indexSymbol,
        interval,
        candleCount: candles.length,
        currentPrice,
      };

      return {
        ...metadata,
        metadata,
        analysis: {
          signal: analysis.signal,
          signalReason: analysis.signalReason,
          currentTrend: analysis.superTrendDirection[analysis.superTrendDirection.length - 1],
          currentRSI: analysis.rsi[analysis.rsi.length - 1],
          currentATR: Math.round(analysis.atr[analysis.atr.length - 1] * 10) / 10,
          superTrendValue: Math.round(analysis.superTrend[analysis.superTrend.length - 1] * 100) / 100,
        },
        recentData: candles.slice(-20).map((c, idx) => {
          const realIdx = candles.length - Math.min(candles.length, 20) + idx;

          return {
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            atr: Math.round((analysis.atr[realIdx] || 0) * 10) / 10,
            superTrend: Math.round((analysis.superTrend[realIdx] || 0) * 100) / 100,
            trend: analysis.superTrendDirection[realIdx] || 'none',
            rsi: analysis.rsi[realIdx] || 0,
          };
        }),
      } satisfies TechnicalAnalysisResponse;
    });

    setCachedRouteResponse(technicalAnalysisCache, cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Chart data error:', error);
    return NextResponse.json({ error: 'Failed to fetch chart data' }, { status: getUpstreamFailureStatus() });
  }
}
