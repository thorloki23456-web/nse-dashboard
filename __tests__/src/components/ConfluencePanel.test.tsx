import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import ConfluencePanel from '@/components/ConfluencePanel';
import type { AnalyticsSnapshot } from '@/lib/types';

const baseSnapshot: AnalyticsSnapshot = {
  symbol: 'NIFTY',
  strategy: 'gamma',
  chain: {
    symbol: 'NIFTY',
    expiryDate: '09-Apr-2026',
    timestamp: '08-Apr-2026 10:00:00',
    underlyingValue: 22120,
    lotSize: 75,
    data: [],
  },
  metrics: {
    gex: 10,
    gammaFlip: 1.2,
    dex: 12,
    ivSkew: 3.5,
    vegaExposure: 6,
    oiImbalance: 9,
    uvr: 1.4,
    pcr: 0.92,
    maxPainDistance: 0.4,
    ltpVsVwapPct: 0.7,
    vpin: 31,
    thetaPressure: 18,
    netDelta: 0.12,
    ivRank: 42,
    totalVolume: 100000,
    avgVolume: 85000,
  },
  signalScores: [],
  confluence: {
    bullishScore: 61,
    bearishScore: 39,
    netScore: 22,
    confidence: 68,
    regime: 'LONG',
    signals: [],
    breakdown: {
      totalSignals: 0,
      totalWeight: 0,
      directionalSpread: 22,
      averageStrength: 68,
      items: [],
    },
    thresholdUsed: 8,
    rationale: 'Bullish confluence dominates.',
  },
  generatedAt: '2026-04-08T10:00:00.000Z',
  technical: null,
  termStructure: null,
};

describe('components/ConfluencePanel', () => {
  it('renders the empty state when no analytics snapshot is available', () => {
    render(<ConfluencePanel snapshot={null} symbol="" expiryDate="" loading={false} />);

    expect(screen.getByText('Awaiting data')).toBeInTheDocument();
    expect(
      screen.getByText('Live confluence output appears once the option chain has a symbol, expiry, and a valid spot price.')
    ).toBeInTheDocument();
  });

  it('renders weekly term-structure expiries and recommendation when available', () => {
    render(
      <ConfluencePanel
        snapshot={{
          ...baseSnapshot,
          termStructure: {
            symbol: 'NIFTY',
            asOf: '2026-04-08T10:00:00.000Z',
            underlyingValue: 22120,
            daysToExpiry: 1,
            features: {
              atmTermSpread: 5,
              putSkewTransfer: -4,
              oiRollRatio: 1.6,
              wallShift: 300,
              pinVsBreakout: 350,
            },
            featureSignals: [
              {
                feature: 'atmTermSpread',
                rawValue: 5,
                direction: 'NEUTRAL',
                strength: 'MODERATE',
                reason: 'Front-week IV is rich but not directionally decisive.',
              },
              {
                feature: 'putSkewTransfer',
                rawValue: -4,
                direction: 'BULLISH',
                strength: 'STRONG',
                reason: 'Fear is not rolling into next week.',
              },
            ],
            confluence: {
              bullishCount: 3,
              bearishCount: 0,
              neutralCount: 1,
              pinCount: 1,
              dominantDirection: 'BULLISH',
              confluenceScore: 54,
            },
            recommendation: {
              action: 'BUY_NEXT_WEEK_ATM',
              direction: 'BULLISH',
              strength: 'MODERATE',
              rationale: ['OI is rolling forward.', 'The next-week wall shifted higher.'],
              riskNote: 'Exit if the roll ratio reverses.',
              suggestedExpiry: 'NEXT_WEEK',
              suggestedStrike: 22300,
              confluenceScore: 54,
            },
          },
        }}
        symbol="NIFTY"
        expiryDate="09-Apr-2026"
        termStructure={{
          currentExpiryDate: '09-Apr-2026',
          nextExpiryDate: '16-Apr-2026',
          error: null,
        }}
      />
    );

    expect(screen.getByText('Weekly Term Structure')).toBeInTheDocument();
    expect(screen.getByText('09-Apr-2026 vs 16-Apr-2026')).toBeInTheDocument();
    expect(screen.getAllByText('BUY_NEXT_WEEK_ATM').length).toBeGreaterThan(0);
    expect(screen.getByText(/The next-week wall shifted higher\./)).toBeInTheDocument();
    expect(screen.getByText('Risk Note: Exit if the roll ratio reverses.')).toBeInTheDocument();
  });

  it('renders a graceful fallback when term-structure data is unavailable', () => {
    render(
      <ConfluencePanel
        snapshot={baseSnapshot}
        symbol="NIFTY"
        expiryDate="09-Apr-2026"
        termStructure={{
          currentExpiryDate: '09-Apr-2026',
          nextExpiryDate: '16-Apr-2026',
          error: 'Failed to fetch one or more option-chain payloads for weekly term structure',
        }}
      />
    );

    expect(
      screen.getByText(
        'Term structure unavailable: Failed to fetch one or more option-chain payloads for weekly term structure'
      )
    ).toBeInTheDocument();
  });
});
