import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import NiftyDecisionPanel from '@/components/NiftyDecisionPanel';
import type { AnalyticsSnapshot } from '@/lib/types';

const snapshot: AnalyticsSnapshot = {
  symbol: 'NIFTY',
  strategy: 'gamma',
  chain: {
    symbol: 'NIFTY',
    expiryDate: '24-Apr-2026',
    timestamp: '2026-04-11T10:00:00.000Z',
    underlyingValue: 22118,
    lotSize: 75,
    data: [
      {
        strikePrice: 22000,
        expiryDate: '24-Apr-2026',
        CE: { openInterest: 150000, changeinOpenInterest: 12000, totalTradedVolume: 210000, lastPrice: 205, impliedVolatility: 16, delta: 0.62 },
        PE: { openInterest: 70000, changeinOpenInterest: -4000, totalTradedVolume: 85000, lastPrice: 98, impliedVolatility: 17, delta: -0.24 },
      },
      {
        strikePrice: 22100,
        expiryDate: '24-Apr-2026',
        CE: { openInterest: 220000, changeinOpenInterest: 18000, totalTradedVolume: 310000, lastPrice: 168, impliedVolatility: 16, delta: 0.48 },
        PE: { openInterest: 110000, changeinOpenInterest: -5000, totalTradedVolume: 125000, lastPrice: 118, impliedVolatility: 17, delta: -0.47 },
      },
      {
        strikePrice: 22200,
        expiryDate: '24-Apr-2026',
        CE: { openInterest: 110000, changeinOpenInterest: 9000, totalTradedVolume: 150000, lastPrice: 127, impliedVolatility: 17, delta: 0.35 },
        PE: { openInterest: 210000, changeinOpenInterest: 17000, totalTradedVolume: 260000, lastPrice: 164, impliedVolatility: 16, delta: -0.58 },
      },
    ],
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
};

describe('components/NiftyDecisionPanel', () => {
  it('renders the long-only selector output for NIFTY snapshots', () => {
    render(<NiftyDecisionPanel snapshot={snapshot} />);

    expect(screen.getByText('NIFTY 50 Intraday Selector')).toBeInTheDocument();
    expect(screen.getByText('BUY CE')).toBeInTheDocument();
    expect(screen.getByText('22100 CE')).toBeInTheDocument();
    expect(screen.getByText('Signal Contributions')).toBeInTheDocument();
  });

  it('stays hidden for non-NIFTY symbols', () => {
    const { container } = render(
      <NiftyDecisionPanel snapshot={{ ...snapshot, symbol: 'RELIANCE', chain: { ...snapshot.chain, symbol: 'RELIANCE' } }} />
    );

    expect(container.firstChild).toBeNull();
  });
});
