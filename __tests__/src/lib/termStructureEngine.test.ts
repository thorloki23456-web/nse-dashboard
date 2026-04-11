import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { blackScholesGreeks } from '@/lib/greeks';
import {
  buildExpiryComparisonSnapshot,
  runTermStructureEngine,
} from '@/lib/termStructureEngine';
import type { ExpiryComparisonSnapshot } from '@/lib/termStructure.types';
import type { OptionChain } from '@/lib/types';

function createChain(
  expiryDate: string,
  strikes: Array<{
    strikePrice: number;
    CE?: Record<string, number | undefined>;
    PE?: Record<string, number | undefined>;
  }>
): OptionChain {
  return {
    symbol: 'NIFTY',
    expiryDate,
    timestamp: '08-Apr-2026 10:00:00',
    underlyingValue: 22000,
    lotSize: 75,
    data: strikes.map((strike) => ({
      strikePrice: strike.strikePrice,
      expiryDate,
      CE: strike.CE
        ? {
            openInterest: strike.CE.openInterest ?? 0,
            changeinOpenInterest: strike.CE.changeinOpenInterest ?? 0,
            totalTradedVolume: strike.CE.totalTradedVolume ?? 0,
            lastPrice: strike.CE.lastPrice ?? 0,
            impliedVolatility: strike.CE.impliedVolatility ?? 0,
            delta: strike.CE.delta,
            gamma: strike.CE.gamma,
            theta: strike.CE.theta,
            vega: strike.CE.vega,
          }
        : undefined,
      PE: strike.PE
        ? {
            openInterest: strike.PE.openInterest ?? 0,
            changeinOpenInterest: strike.PE.changeinOpenInterest ?? 0,
            totalTradedVolume: strike.PE.totalTradedVolume ?? 0,
            lastPrice: strike.PE.lastPrice ?? 0,
            impliedVolatility: strike.PE.impliedVolatility ?? 0,
            delta: strike.PE.delta,
            gamma: strike.PE.gamma,
            theta: strike.PE.theta,
            vega: strike.PE.vega,
          }
        : undefined,
    })),
  };
}

function createManualSnapshot(
  overrides: Partial<ExpiryComparisonSnapshot> = {}
): ExpiryComparisonSnapshot {
  const currentWeek = createChain('2026-04-09', [
    {
      strikePrice: 22000,
      CE: { openInterest: 1200, totalTradedVolume: 1500, lastPrice: 120, impliedVolatility: 22 },
      PE: { openInterest: 1200, totalTradedVolume: 1400, lastPrice: 118, impliedVolatility: 24 },
    },
    {
      strikePrice: 22300,
      CE: { openInterest: 150, totalTradedVolume: 300, lastPrice: 45, impliedVolatility: 19 },
      PE: { openInterest: 150, totalTradedVolume: 250, lastPrice: 220, impliedVolatility: 28 },
    },
  ]);
  const nextWeek = createChain('2026-04-16', [
    {
      strikePrice: 22000,
      CE: { openInterest: 250, totalTradedVolume: 500, lastPrice: 150, impliedVolatility: 18 },
      PE: { openInterest: 250, totalTradedVolume: 450, lastPrice: 150, impliedVolatility: 20 },
    },
    {
      strikePrice: 22300,
      CE: { openInterest: 1800, totalTradedVolume: 1800, lastPrice: 95, impliedVolatility: 16 },
      PE: { openInterest: 1800, totalTradedVolume: 1750, lastPrice: 105, impliedVolatility: 21 },
    },
  ]);

  return {
    symbol: 'NIFTY',
    asOf: '2026-04-08T09:00:00.000Z',
    underlyingValue: 22350,
    daysToCurrentExpiry: 1,
    daysToNextExpiry: 8,
    expiries: {
      currentWeek,
      nextWeek,
    },
    buckets: [
      {
        bucket: 'ATM',
        currentWeek: {
          strike: 22000,
          iv: 25,
          oi: 2000,
          volume: 2900,
        },
        nextWeek: {
          strike: 22300,
          iv: 20,
          oi: 3200,
          volume: 2600,
        },
        spread: {
          ivSpread: 5,
          oiRatio: 1.6,
          volumeRatio: 0.9,
          thetaDropOff: 1.5,
          gammaRamp: 1.4,
        },
      },
      {
        bucket: 'CALL_25D',
        currentWeek: {
          strike: 22300,
          iv: 18,
          oi: 800,
          volume: 900,
        },
        nextWeek: {
          strike: 22600,
          iv: 16,
          oi: 1400,
          volume: 1300,
        },
        spread: {
          ivSpread: 2,
          oiRatio: 1.75,
          volumeRatio: 1.44,
          thetaDropOff: 1.2,
          gammaRamp: 1.1,
        },
      },
      {
        bucket: 'PUT_25D',
        currentWeek: {
          strike: 21800,
          iv: 26,
          oi: 900,
          volume: 850,
        },
        nextWeek: {
          strike: 21700,
          iv: 20,
          oi: 1200,
          volume: 1000,
        },
        spread: {
          ivSpread: 6,
          oiRatio: 1.33,
          volumeRatio: 1.18,
          thetaDropOff: 1.1,
          gammaRamp: 1.05,
        },
      },
    ],
    ...overrides,
  };
}

describe('lib/termStructureEngine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-04-08T09:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses live delta values when present to select the 25-delta buckets', () => {
    const currentWeek = createChain('2026-04-09', [
      {
        strikePrice: 22000,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 100, impliedVolatility: 18, delta: 0.42 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 90, impliedVolatility: 20, delta: -0.12 },
      },
      {
        strikePrice: 22100,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 80, impliedVolatility: 18, delta: 0.24 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 100, impliedVolatility: 20, delta: -0.24 },
      },
      {
        strikePrice: 22200,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 60, impliedVolatility: 18, delta: 0.11 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 120, impliedVolatility: 20, delta: -0.39 },
      },
    ]);
    const nextWeek = createChain('2026-04-16', currentWeek.data);

    const snapshot = buildExpiryComparisonSnapshot(
      currentWeek,
      nextWeek,
      22080,
      '2026-04-09',
      '2026-04-16'
    );

    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'CALL_25D')?.currentWeek.strike).toBe(22100);
    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'PUT_25D')?.currentWeek.strike).toBe(22100);
  });

  it('uses Black-Scholes fallback Greeks when live deltas are missing', () => {
    const currentWeek = createChain('2026-04-09', [
      {
        strikePrice: 22000,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 130, impliedVolatility: 18 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 70, impliedVolatility: 18 },
      },
      {
        strikePrice: 22200,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 90, impliedVolatility: 18 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 95, impliedVolatility: 18 },
      },
      {
        strikePrice: 22400,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 60, impliedVolatility: 18 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 130, impliedVolatility: 18 },
      },
    ]);
    const nextWeek = createChain('2026-04-16', currentWeek.data);
    const spot = 22100;
    const strikePrices = currentWeek.data.map((strike) => strike.strikePrice);
    const expectedCallStrike = strikePrices.reduce((bestStrike, strikePrice) => {
      const bestDelta = Math.abs(
        blackScholesGreeks(spot, bestStrike, 1 / 365, 0.1, 0.18, true).delta - 0.25
      );
      const currentDelta = Math.abs(
        blackScholesGreeks(spot, strikePrice, 1 / 365, 0.1, 0.18, true).delta - 0.25
      );

      return currentDelta < bestDelta ? strikePrice : bestStrike;
    });
    const expectedPutStrike = strikePrices.reduce((bestStrike, strikePrice) => {
      const bestDelta = Math.abs(
        blackScholesGreeks(spot, bestStrike, 1 / 365, 0.1, 0.18, false).delta + 0.25
      );
      const currentDelta = Math.abs(
        blackScholesGreeks(spot, strikePrice, 1 / 365, 0.1, 0.18, false).delta + 0.25
      );

      return currentDelta < bestDelta ? strikePrice : bestStrike;
    });

    const snapshot = buildExpiryComparisonSnapshot(
      currentWeek,
      nextWeek,
      spot,
      '2026-04-09',
      '2026-04-16'
    );

    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'CALL_25D')?.currentWeek.strike).toBe(expectedCallStrike);
    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'PUT_25D')?.currentWeek.strike).toBe(expectedPutStrike);
  });

  it('falls back to simple OTM strike selection when Greeks cannot be derived', () => {
    const currentWeek = createChain('2026-04-09', [
      {
        strikePrice: 21800,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 170, impliedVolatility: 0 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 40, impliedVolatility: 0 },
      },
      {
        strikePrice: 22000,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 100, impliedVolatility: 0 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 90, impliedVolatility: 0 },
      },
      {
        strikePrice: 22200,
        CE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 50, impliedVolatility: 0 },
        PE: { openInterest: 100, totalTradedVolume: 100, lastPrice: 140, impliedVolatility: 0 },
      },
    ]);
    const nextWeek = createChain('2026-04-16', currentWeek.data);

    const snapshot = buildExpiryComparisonSnapshot(
      currentWeek,
      nextWeek,
      22000,
      '2026-04-09',
      '2026-04-16'
    );

    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'CALL_25D')?.currentWeek.strike).toBe(22200);
    expect(snapshot.buckets.find((bucket) => bucket.bucket === 'PUT_25D')?.currentWeek.strike).toBe(21800);
  });

  it('computes the five term-structure features from the comparison snapshot', () => {
    const result = runTermStructureEngine(createManualSnapshot());

    expect(result.features).toEqual({
      atmTermSpread: 5,
      putSkewTransfer: -4,
      oiRollRatio: 1.6,
      wallShift: 300,
      pinVsBreakout: 350,
    });
  });

  it('returns SELL_THIS_WEEK_PREMIUM for a pin-dominant term structure', () => {
    const result = runTermStructureEngine(
      createManualSnapshot({
        underlyingValue: 22005,
        daysToCurrentExpiry: 1,
        buckets: [
          {
            bucket: 'ATM',
            currentWeek: { strike: 22000, iv: 28, oi: 2500, volume: 3000 },
            nextWeek: { strike: 22000, iv: 20, oi: 900, volume: 1100 },
            spread: { ivSpread: 8, oiRatio: 0.36, volumeRatio: 0.36, thetaDropOff: 1.8, gammaRamp: 1.6 },
          },
          {
            bucket: 'CALL_25D',
            currentWeek: { strike: 22300, iv: 19, oi: 900, volume: 1000 },
            nextWeek: { strike: 22300, iv: 18, oi: 500, volume: 600 },
            spread: { ivSpread: 1, oiRatio: 0.56, volumeRatio: 0.6, thetaDropOff: 1.2, gammaRamp: 1.1 },
          },
          {
            bucket: 'PUT_25D',
            currentWeek: { strike: 21700, iv: 20, oi: 1000, volume: 950 },
            nextWeek: { strike: 21700, iv: 19, oi: 450, volume: 500 },
            spread: { ivSpread: 1, oiRatio: 0.45, volumeRatio: 0.53, thetaDropOff: 1.2, gammaRamp: 1.1 },
          },
        ],
      })
    );

    expect(result.recommendation.action).toBe('SELL_THIS_WEEK_PREMIUM');
    expect(result.recommendation.direction).toBe('EXPIRY_PIN');
  });

  it('returns BUY_NEXT_WEEK_ATM for strong bullish roll-forward confluence', () => {
    const result = runTermStructureEngine(createManualSnapshot());

    expect(result.recommendation.action).toBe('BUY_NEXT_WEEK_ATM');
    expect(result.recommendation.direction).toBe('BULLISH');
  });

  it('returns BUY_NEXT_WEEK_OTM_PUT for strong bearish skew transfer and forward risk', () => {
    const bearishSnapshot = createManualSnapshot({
      underlyingValue: 21650,
      buckets: [
        {
          bucket: 'ATM',
          currentWeek: { strike: 21700, iv: 18, oi: 1600, volume: 2100 },
          nextWeek: { strike: 21700, iv: 24, oi: 2200, volume: 2500 },
          spread: { ivSpread: -6, oiRatio: 1.38, volumeRatio: 1.19, thetaDropOff: 0.8, gammaRamp: 0.9 },
        },
        {
          bucket: 'CALL_25D',
          currentWeek: { strike: 21900, iv: 15, oi: 600, volume: 700 },
          nextWeek: { strike: 21900, iv: 16, oi: 700, volume: 800 },
          spread: { ivSpread: -1, oiRatio: 1.17, volumeRatio: 1.14, thetaDropOff: 0.8, gammaRamp: 0.9 },
        },
        {
          bucket: 'PUT_25D',
          currentWeek: { strike: 21500, iv: 19, oi: 900, volume: 950 },
          nextWeek: { strike: 21400, iv: 26, oi: 1600, volume: 1700 },
          spread: { ivSpread: -7, oiRatio: 1.78, volumeRatio: 1.79, thetaDropOff: 0.8, gammaRamp: 0.9 },
        },
      ],
      expiries: {
        currentWeek: createChain('2026-04-09', [
          {
            strikePrice: 21700,
            CE: { openInterest: 1000, totalTradedVolume: 1200, lastPrice: 90, impliedVolatility: 18 },
            PE: { openInterest: 1000, totalTradedVolume: 1300, lastPrice: 115, impliedVolatility: 22 },
          },
          {
            strikePrice: 21400,
            CE: { openInterest: 150, totalTradedVolume: 220, lastPrice: 150, impliedVolatility: 17 },
            PE: { openInterest: 150, totalTradedVolume: 260, lastPrice: 55, impliedVolatility: 24 },
          },
        ]),
        nextWeek: createChain('2026-04-16', [
          {
            strikePrice: 21700,
            CE: { openInterest: 350, totalTradedVolume: 450, lastPrice: 110, impliedVolatility: 24 },
            PE: { openInterest: 350, totalTradedVolume: 450, lastPrice: 145, impliedVolatility: 28 },
          },
          {
            strikePrice: 21400,
            CE: { openInterest: 1800, totalTradedVolume: 1600, lastPrice: 180, impliedVolatility: 21 },
            PE: { openInterest: 1800, totalTradedVolume: 1800, lastPrice: 75, impliedVolatility: 30 },
          },
        ]),
      },
    });
    const result = runTermStructureEngine(bearishSnapshot);

    expect(result.recommendation.action).toBe('BUY_NEXT_WEEK_OTM_PUT');
    expect(result.recommendation.direction).toBe('BEARISH');
  });

  it('returns WAIT_FOR_EXPIRY_RESOLUTION when confluence is weak into expiry', () => {
    const result = runTermStructureEngine(
      createManualSnapshot({
        daysToCurrentExpiry: 1,
        underlyingValue: 22120,
        buckets: [
          {
            bucket: 'ATM',
            currentWeek: { strike: 22000, iv: 20, oi: 2000, volume: 2000 },
            nextWeek: { strike: 22000, iv: 19.5, oi: 2050, volume: 2050 },
            spread: { ivSpread: 0.5, oiRatio: 1.03, volumeRatio: 1.02, thetaDropOff: 1.05, gammaRamp: 1.02 },
          },
          {
            bucket: 'CALL_25D',
            currentWeek: { strike: 22200, iv: 18, oi: 800, volume: 850 },
            nextWeek: { strike: 22200, iv: 17.8, oi: 820, volume: 840 },
            spread: { ivSpread: 0.2, oiRatio: 1.03, volumeRatio: 0.99, thetaDropOff: 1.01, gammaRamp: 1.01 },
          },
          {
            bucket: 'PUT_25D',
            currentWeek: { strike: 21800, iv: 18.2, oi: 820, volume: 830 },
            nextWeek: { strike: 21800, iv: 18, oi: 810, volume: 820 },
            spread: { ivSpread: 0.2, oiRatio: 0.99, volumeRatio: 0.99, thetaDropOff: 1.01, gammaRamp: 1.01 },
          },
        ],
        expiries: {
          currentWeek: createChain('2026-04-09', [
            {
              strikePrice: 22000,
              CE: { openInterest: 1000, totalTradedVolume: 1200, lastPrice: 115, impliedVolatility: 20 },
              PE: { openInterest: 1000, totalTradedVolume: 1250, lastPrice: 110, impliedVolatility: 21 },
            },
            {
              strikePrice: 22250,
              CE: { openInterest: 200, totalTradedVolume: 300, lastPrice: 55, impliedVolatility: 18 },
              PE: { openInterest: 200, totalTradedVolume: 310, lastPrice: 190, impliedVolatility: 22 },
            },
          ]),
          nextWeek: createChain('2026-04-16', [
            {
              strikePrice: 22000,
              CE: { openInterest: 300, totalTradedVolume: 500, lastPrice: 145, impliedVolatility: 19 },
              PE: { openInterest: 300, totalTradedVolume: 490, lastPrice: 135, impliedVolatility: 20 },
            },
            {
              strikePrice: 22250,
              CE: { openInterest: 1600, totalTradedVolume: 1500, lastPrice: 90, impliedVolatility: 17 },
              PE: { openInterest: 1600, totalTradedVolume: 1480, lastPrice: 95, impliedVolatility: 21 },
            },
          ]),
        },
      })
    );

    expect(result.recommendation.action).toBe('WAIT_FOR_EXPIRY_RESOLUTION');
  });
});
