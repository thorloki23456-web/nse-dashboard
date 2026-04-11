import { describe, expect, it } from '@jest/globals';

import { selectNiftyLongOnlyTrade } from '@/lib/strategies/intraday-nifty50';
import type { AnalyticsSnapshot, OptionStrike } from '@/lib/types';

function makeChain(overrides: Partial<OptionStrike>[] = []): OptionStrike[] {
  const base: OptionStrike[] = [
    {
      strikePrice: 22000,
      expiryDate: '24-Apr-2026',
      CE: { openInterest: 180000, changeinOpenInterest: 15000, totalTradedVolume: 250000, lastPrice: 210, impliedVolatility: 16, delta: 0.62 },
      PE: { openInterest: 85000, changeinOpenInterest: -7000, totalTradedVolume: 95000, lastPrice: 92, impliedVolatility: 17, delta: -0.24 },
    },
    {
      strikePrice: 22100,
      expiryDate: '24-Apr-2026',
      CE: { openInterest: 220000, changeinOpenInterest: 22000, totalTradedVolume: 320000, lastPrice: 168, impliedVolatility: 16, delta: 0.48 },
      PE: { openInterest: 110000, changeinOpenInterest: -6000, totalTradedVolume: 122000, lastPrice: 118, impliedVolatility: 17, delta: -0.47 },
    },
    {
      strikePrice: 22200,
      expiryDate: '24-Apr-2026',
      CE: { openInterest: 120000, changeinOpenInterest: 9000, totalTradedVolume: 150000, lastPrice: 126, impliedVolatility: 17, delta: 0.35 },
      PE: { openInterest: 210000, changeinOpenInterest: 18000, totalTradedVolume: 280000, lastPrice: 165, impliedVolatility: 16, delta: -0.58 },
    },
  ];

  return base.map((strike, index) => ({ ...strike, ...overrides[index] }));
}

function makeSnapshot(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  return {
    symbol: 'NIFTY',
    strategy: 'gamma',
    chain: {
      symbol: 'NIFTY',
      expiryDate: '24-Apr-2026',
      timestamp: '2026-04-11T10:00:00.000Z',
      underlyingValue: 22118,
      lotSize: 75,
      data: makeChain(),
    },
    metrics: {
      gex: 18,
      gammaFlip: 2.1,
      dex: 14,
      ivSkew: 2.6,
      vegaExposure: 7.2,
      oiImbalance: 24,
      uvr: 1.8,
      pcr: 0.87,
      maxPainDistance: 0.5,
      ltpVsVwapPct: 0.9,
      vpin: 24,
      thetaPressure: 18,
      netDelta: 0.14,
      ivRank: 32,
      totalVolume: 700000,
      avgVolume: 450000,
    },
    signalScores: [],
    confluence: {
      bullishScore: 68,
      bearishScore: 32,
      netScore: 28,
      confidence: 74,
      regime: 'LONG',
      signals: [],
      breakdown: { totalSignals: 0, totalWeight: 0, directionalSpread: 36, averageStrength: 74, items: [] },
      thresholdUsed: 8,
      rationale: 'Bullish confluence dominates.',
    },
    generatedAt: '2026-04-11T10:00:00.000Z',
    technical: {
      signal: 'BUY',
      signalReason: 'Spot is above SuperTrend with RSI confirmation.',
      currentTrend: 'up',
      currentRSI: 61,
      currentATR: 78,
      superTrendValue: 22080,
      currentPrice: 22118,
      candleCount: 20,
    },
    termStructure: null,
    ...overrides,
  };
}

describe('lib/strategies/intraday-nifty50', () => {
  it('returns BUY_CE when confluence, flow, and technical trend align bullishly', () => {
    const decision = selectNiftyLongOnlyTrade(makeSnapshot());

    expect(decision).not.toBeNull();
    expect(decision?.action).toBe('BUY_CE');
    expect(decision?.selectedContract?.optionType).toBe('CE');
    expect(decision?.selectedContract?.strike).toBe(22100);
    expect(decision?.blockers).toHaveLength(0);
  });

  it('returns BUY_PE when the current inputs align bearishly', () => {
    const bearishSnapshot = makeSnapshot({
      metrics: {
        ...makeSnapshot().metrics,
        gammaFlip: -2.4,
        oiImbalance: -26,
        pcr: 1.24,
        ltpVsVwapPct: -1.1,
        uvr: 1.9,
      },
      confluence: {
        ...makeSnapshot().confluence,
        bullishScore: 29,
        bearishScore: 71,
        netScore: -30,
        confidence: 76,
        regime: 'SHORT',
        rationale: 'Bearish confluence dominates.',
      },
      technical: {
        signal: 'SELL',
        signalReason: 'Spot is below SuperTrend with RSI pressure.',
        currentTrend: 'down',
        currentRSI: 39,
        currentATR: 82,
        superTrendValue: 22180,
        currentPrice: 22118,
        candleCount: 20,
      },
    });

    const decision = selectNiftyLongOnlyTrade(bearishSnapshot);

    expect(decision).not.toBeNull();
    expect(decision?.action).toBe('BUY_PE');
    expect(decision?.selectedContract?.optionType).toBe('PE');
    expect(decision?.selectedContract?.strike).toBeGreaterThanOrEqual(22100);
    expect(decision?.blockers).toHaveLength(0);
  });

  it('returns NO_TRADE when the edge is too weak for a long-only intraday entry', () => {
    const neutralSnapshot = makeSnapshot({
      metrics: {
        ...makeSnapshot().metrics,
        gammaFlip: 0.2,
        oiImbalance: 3,
        pcr: 1.02,
        ltpVsVwapPct: 0.1,
        uvr: 1.03,
        vpin: 40,
      },
      confluence: {
        ...makeSnapshot().confluence,
        bullishScore: 54,
        bearishScore: 46,
        netScore: 8,
        confidence: 52,
        regime: 'NEUTRAL',
        rationale: 'No dominant side is in control.',
      },
      technical: {
        signal: 'NEUTRAL',
        signalReason: 'Spot is range-bound.',
        currentTrend: 'none',
        currentRSI: 49,
        currentATR: 74,
        superTrendValue: 22110,
        currentPrice: 22118,
        candleCount: 20,
      },
    });

    const decision = selectNiftyLongOnlyTrade(neutralSnapshot);

    expect(decision).not.toBeNull();
    expect(decision?.action).toBe('NO_TRADE');
    expect(decision?.selectedContract).toBeNull();
    expect(decision?.blockers).toEqual(
      expect.arrayContaining([
        'Confluence confidence is below the minimum trade threshold.',
        'Directional edge stayed below the minimum conviction threshold.',
        'Flow follow-through is too weak for an intraday long option entry.',
      ])
    );
  });
});
