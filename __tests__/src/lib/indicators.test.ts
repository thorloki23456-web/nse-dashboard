import { describe, expect, it } from '@jest/globals';

import {
  analyzeCandles,
  computeRSI,
  computeSuperTrend,
  generateSignal,
  type Candle,
} from '@/lib/indicators';

const trendingCandles: Candle[] = [
  { time: '09:15', open: 100, high: 101, low: 99, close: 100 },
  { time: '09:18', open: 100, high: 103, low: 100, close: 102 },
  { time: '09:21', open: 102, high: 105, low: 101, close: 104 },
  { time: '09:24', open: 104, high: 107, low: 103, close: 106 },
  { time: '09:27', open: 106, high: 109, low: 105, close: 108 },
  { time: '09:30', open: 108, high: 111, low: 107, close: 110 },
  { time: '09:33', open: 110, high: 113, low: 109, close: 112 },
  { time: '09:36', open: 112, high: 115, low: 111, close: 114 },
];

// PURPOSE: Validate indicator math and signal generation that powers the technical-analysis API.
describe('lib/indicators', () => {
  // PURPOSE: A steadily rising close series should drive RSI toward the overbought ceiling.
  it('computes a 100 RSI reading when every close increases', () => {
    // These candles only move upward so the downside average remains zero.
    const risingCandles: Candle[] = [
      { time: '09:15', open: 100, high: 101, low: 99, close: 100 },
      { time: '09:18', open: 101, high: 102, low: 100, close: 101 },
      { time: '09:21', open: 102, high: 103, low: 101, close: 102 },
      { time: '09:24', open: 103, high: 104, low: 102, close: 103 },
      { time: '09:27', open: 104, high: 105, low: 103, close: 104 },
      { time: '09:30', open: 105, high: 106, low: 104, close: 105 },
      { time: '09:33', open: 106, high: 107, low: 105, close: 106 },
      { time: '09:36', open: 107, high: 108, low: 106, close: 107 },
    ];

    // The shorter RSI window makes the all-up trend easier to evaluate deterministically.
    const rsi = computeRSI(risingCandles, 7);

    // The final RSI should pin to 100 because there are no average losses.
    expect(rsi[rsi.length - 1]).toBe(100);
  });

  // PURPOSE: This verifies the exact crossover pattern needed to emit a BUY signal.
  it('emits a BUY signal when SuperTrend flips up and RSI momentum accelerates', () => {
    // This pattern mirrors the implementation contract of five down candles followed by one up candle.
    const stx = ['down', 'down', 'down', 'down', 'down', 'up'] as const;
    // These RSI values stay inside the valid range and improve faster on the latest candle.
    const rsi = [42, 44, 45, 46, 48, 53];

    // The generator is the purest place to assert the crossover logic without candle noise.
    const result = generateSignal([...stx], rsi);

    // A valid crossover plus rising RSI momentum should produce a BUY.
    expect(result.signal).toBe('BUY');
    // The reason string should explain the crossover to downstream UI consumers.
    expect(result.reason).toContain('SuperTrend crossed UP');
  });

  // PURPOSE: This verifies the mirror-image crossover pattern needed to emit a SELL signal.
  it('emits a SELL signal when SuperTrend flips down and RSI momentum weakens', () => {
    // This pattern mirrors the implementation contract of five up candles followed by one down candle.
    const stx = ['up', 'up', 'up', 'up', 'up', 'down'] as const;
    // These RSI values stay inside the valid range and slow down into the last candle.
    const rsi = [58, 57, 56, 55, 54, 50];

    // The pure generator test keeps the signal assertion independent from candle aggregation.
    const result = generateSignal([...stx], rsi);

    // A valid downward crossover plus weakening RSI should produce a SELL.
    expect(result.signal).toBe('SELL');
    // The reason string should explain the downward crossover for the UI badge.
    expect(result.reason).toContain('SuperTrend crossed DOWN');
  });

  // PURPOSE: This protects the fallback branch when there are not enough candles for a six-candle signal pattern.
  it('returns NEUTRAL when there are fewer than six trend points', () => {
    // A short trend history should never emit a trading signal.
    const result = generateSignal(['down', 'down', 'up'], [45, 46, 47]);

    // The generator should stay neutral instead of overfitting thin data.
    expect(result.signal).toBe('NEUTRAL');
    // The reason should explain why no signal was produced.
    expect(result.reason).toContain('Not enough data');
  });

  // PURPOSE: This integration test ensures the higher-level analyzer returns aligned arrays for the API route.
  it('produces indicator arrays with the same length as the input candles', () => {
    // This candle set is long enough to exercise ATR, SuperTrend, and RSI output arrays.
    const analysis = analyzeCandles(trendingCandles, 3, 2, 3);

    // The analyzer should preserve candle count for downstream table rendering.
    expect(analysis.candles).toHaveLength(trendingCandles.length);
    // ATR values must align one-to-one with the original candles.
    expect(analysis.atr).toHaveLength(trendingCandles.length);
    // SuperTrend values must align one-to-one with the original candles.
    expect(analysis.superTrend).toHaveLength(trendingCandles.length);
    // Direction labels must align one-to-one with the original candles.
    expect(analysis.superTrendDirection).toHaveLength(trendingCandles.length);
    // RSI values must align one-to-one with the original candles.
    expect(analysis.rsi).toHaveLength(trendingCandles.length);
  });

  // PURPOSE: This checks the lower-level SuperTrend helper without asserting fragile exact values.
  it('returns length-aligned ATR and trend arrays for a valid candle sequence', () => {
    // A realistic uptrend is enough to ensure the helper generates non-empty outputs.
    const result = computeSuperTrend(trendingCandles, 3, 2);

    // ATR output needs to stay aligned with the candle series.
    expect(result.atr).toHaveLength(trendingCandles.length);
    // SuperTrend output needs to stay aligned with the candle series.
    expect(result.st).toHaveLength(trendingCandles.length);
    // Direction output needs to stay aligned with the candle series.
    expect(result.stx).toHaveLength(trendingCandles.length);
    // Once the warm-up period passes, the helper should emit a real direction label.
    expect(result.stx.slice(3)).toContain('up');
  });
});
