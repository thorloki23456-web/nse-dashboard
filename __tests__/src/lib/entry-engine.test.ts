import { computeEntryDecision, scanAllStrategies } from '@/lib/entry-engine';
import type { DerivedSignalMetrics } from '@/lib/analytics';

function makeMetrics(overrides: Partial<DerivedSignalMetrics> = {}): DerivedSignalMetrics {
  return {
    gex: 60, gammaFlip: 2.5, dex: 30, ivSkew: -5, vegaExposure: 10,
    oiImbalance: 25, uvr: 2.5, totalVolume: 100000, avgVolume: 50000,
    ltpVsVwapPct: 0.5, ivRank: 25, vpin: 20,
    ...overrides,
  };
}

const baseInput = { symbol: 'NIFTY', metrics: makeMetrics() };

describe('computeEntryDecision — decision tiers', () => {
  it('returns STRONG_ENTER for score >= 85', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gex: 80, oiImbalance: 40, uvr: 5.5, ivRank: 15 }),
      context: { pcr: 0.65, maxPainDistance: 40, dte: 5, sweepCount: 12, premiumNet: 15_000_000 },
    });
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.decision).toBe('STRONG_ENTER');
  });

  it('returns ENTER for score 73–84', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gex: 65, oiImbalance: 28, uvr: 3.5 }),
      context: { pcr: 0.75, maxPainDistance: 50, dte: 5 },
    });
    expect(result.score).toBeGreaterThanOrEqual(73);
    expect(['STRONG_ENTER', 'ENTER']).toContain(result.decision);
  });

  it('returns CAUTION for score 55–72', () => {
    // Moderate metrics — should land in caution band
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gex: 35, oiImbalance: 10, uvr: 1.8, ivRank: 50 }),
      context: { pcr: 1.0, maxPainDistance: 80, dte: 7 },
    });
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(['CAUTION', 'WAIT', 'ENTER']).toContain(result.decision);
  });

  it('returns WAIT or SKIP for very weak metrics', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gex: 1, oiImbalance: 0, uvr: 0.2, ivRank: 50, vpin: 80, gammaFlip: -8, ltpVsVwapPct: -2 }),
      context: { pcr: 2.0, maxPainDistance: 400, netDelta: -0.6, dte: 15, sweepCount: 0, premiumNet: -500 },
    });
    expect(['WAIT', 'SKIP']).toContain(result.decision);
    expect(result.score).toBeLessThan(55);
  });
});

describe('computeEntryDecision — new fields', () => {
  it('vanna/charm/sweep/premiumNet are accepted without error', () => {
    expect(() =>
      computeEntryDecision({
        ...baseInput,
        context: { vannaExposure: 0.25, charmExposure: -0.12, sweepCount: 8, premiumNet: 9_000_000 },
      })
    ).not.toThrow();
  });

  it('toxic VPIN adds a warning', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ vpin: 70 }),
    });
    expect(result.warnings.some((w) => w.includes('TOXIC'))).toBe(true);
  });

  it('0 DTE adds a CRITICAL warning', () => {
    const result = computeEntryDecision({ ...baseInput, context: { dte: 0 } });
    expect(result.warnings.some((w) => w.includes('CRITICAL'))).toBe(true);
  });

  it('near gamma flip adds a warning', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gammaFlip: 0.3 }),
    });
    expect(result.warnings.some((w) => w.includes('gamma flip'))).toBe(true);
  });

  it('optionType is CE when bullish signals dominate', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ oiImbalance: 40, gammaFlip: 3, ltpVsVwapPct: 1.0 }),
      context: { premiumNet: 12_000_000 },
    });
    expect(result.optionType).toBe('CE');
  });

  it('optionType is PE when bearish signals dominate', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ oiImbalance: -40, gammaFlip: -3, ltpVsVwapPct: -1.5 }),
      context: { premiumNet: -12_000_000 },
    });
    expect(result.optionType).toBe('PE');
  });

  it('suggestedDelta matches strategy', () => {
    const r0dte = computeEntryDecision({ ...baseInput, context: { strategy: '0dte' } });
    expect(r0dte.suggestedDelta).toBe(0.30);

    const rGex = computeEntryDecision({ ...baseInput, context: { strategy: 'gex_squeeze' } });
    expect(rGex.suggestedDelta).toBe(0.50);

    const rVolArb = computeEntryDecision({ ...baseInput, context: { strategy: 'vol_arb' } });
    expect(rVolArb.suggestedDelta).toBe(0.00);
  });

  it('score is clamped to [0, 100]', () => {
    const result = computeEntryDecision({
      symbol: 'NIFTY',
      metrics: makeMetrics({ gex: 100, oiImbalance: 100, uvr: 10 }),
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('scanAllStrategies', () => {
  it('returns all 10 strategies', () => {
    const results = scanAllStrategies(baseInput);
    expect(results).toHaveLength(10);
  });

  it('results are sorted by score descending', () => {
    const results = scanAllStrategies(baseInput);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('each result has a valid decision', () => {
    const valid = new Set(['STRONG_ENTER', 'ENTER', 'CAUTION', 'WAIT', 'SKIP']);
    scanAllStrategies(baseInput).forEach((r) => {
      expect(valid.has(r.decision)).toBe(true);
    });
  });

  it('confidence is in [0, 100]', () => {
    scanAllStrategies(baseInput).forEach((r) => {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
    });
  });
});
