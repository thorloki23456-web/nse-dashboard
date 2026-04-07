import { describe, expect, it } from '@jest/globals';

import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
  calculateSMA,
  findSupportResistance,
  generateBollingerMeanReversion,
  generateMACrossover,
  generateRSIMomentum,
  generateVolatilityBreakout,
} from '@/lib/strategies';

// PURPOSE: Validate the spot-strategy helper functions that power the strategy sandbox.
describe('lib/strategies', () => {
  // PURPOSE: Moving-average crossover logic depends on the SMA helper returning deterministic warm-up nulls.
  it('computes SMA values with nulls during the warm-up period', () => {
    // A short price sequence makes the rolling-window math easy to inspect.
    const sma = calculateSMA([1, 2, 3, 4, 5], 3);

    // The first two entries should be null because there are not enough values yet.
    expect(sma).toEqual([null, null, 2, 3, 4]);
  });

  // PURPOSE: EMA seeding needs to start from the SMA so the strategy signals stay stable.
  it('computes EMA values from the seeded SMA baseline', () => {
    // This simple series makes the EMA seed and follow-on smoothing predictable.
    const ema = calculateEMA([1, 2, 3, 4, 5], 3);

    // The EMA should warm up with null values until enough samples are available.
    expect(ema[0]).toBeNull();
    // The first EMA value should equal the 3-period SMA seed.
    expect(ema[2]).toBe(2);
    // Later EMA values should smooth toward the latest prices.
    expect(ema[4]).toBeCloseTo(4, 5);
  });

  // PURPOSE: Momentum strategies depend on RSI rising above neutral in an uptrend.
  it('computes RSI values above 50 for a net-up price series', () => {
    // This sequence trends upward while still including small pullbacks.
    const rsi = calculateRSI([100, 102, 101, 104, 106, 105, 108, 110], 3);

    // The final RSI should sit above neutral because gains dominate losses.
    expect(rsi[rsi.length - 1]).toBeGreaterThan(50);
  });

  // PURPOSE: Bollinger strategies require null warm-up entries and real bands after the lookback window.
  it('computes Bollinger Bands after the window is satisfied', () => {
    // A monotonic sequence keeps the expected band shape easy to reason about.
    const bands = calculateBollingerBands([10, 11, 12, 13, 14], 3, 2);

    // The upper band should be unavailable until the rolling window fills.
    expect(bands.upperBand[1]).toBeNull();
    // The lower band should also be unavailable until the rolling window fills.
    expect(bands.lowerBand[1]).toBeNull();
    // The first computed upper band should sit above the moving average.
    expect((bands.upperBand[2] as number) > 11).toBe(true);
    // The first computed lower band should sit below the moving average.
    expect((bands.lowerBand[2] as number) < 11).toBe(true);
  });

  // PURPOSE: Breakout strategies depend on rolling support, resistance, and ATR values being aligned.
  it('tracks rolling support, resistance, and ATR from prior prices', () => {
    // This sequence creates a simple trend with enough history for the rolling helpers.
    const prices = [100, 102, 101, 103, 105, 104, 107, 109];

    // These levels are used by the breakout generator to compare the current price to prior structure.
    const levels = findSupportResistance(prices, 3);
    // ATR provides the volatility confirmation term for breakout entries.
    const atr = calculateATR(prices, 3);

    // Support should use the lowest price from the prior lookback window.
    expect(levels.supportLvl[4]).toBe(101);
    // Resistance should use the highest price from the prior lookback window.
    expect(levels.resistanceLvl[4]).toBe(103);
    // ATR should become positive once there are enough prices to average ranges.
    expect(atr[4]).toBeGreaterThan(0);
  });

  // PURPOSE: This protects the trend-following signal logic used by the MA strategy card.
  it('emits a buy on a bullish MA crossover and a sell on a bearish crossover', () => {
    // This price path rises long enough to trigger a buy and then falls enough to trigger an exit.
    const prices = [10, 9, 8, 9, 10, 11, 12, 11, 10, 9, 8];
    // A short fast/slow pairing keeps the crossover points compact in test data.
    const signals = generateMACrossover(prices, 2, 3);

    // The strategy should find a bullish crossover entry.
    expect(signals).toContain(1);
    // The strategy should later find a bearish crossover exit.
    expect(signals).toContain(-1);
  });

  // PURPOSE: This validates the RSI momentum entry and exit rules with the EMA trend filter.
  it('emits RSI momentum entries and exits when RSI and EMA conditions align', () => {
    // This series dips first, then trends higher, then cools off to create an entry and exit.
    const prices = [100, 95, 90, 92, 95, 100, 105, 110, 115, 112, 108, 100];
    // Shorter periods make the trigger conditions reachable in a compact test vector.
    const signals = generateRSIMomentum(prices, 3, 3);

    // The strategy should buy once RSI rebounds above oversold while price is above the EMA.
    expect(signals).toContain(1);
    // The strategy should sell once the momentum filter weakens again.
    expect(signals).toContain(-1);
  });

  // PURPOSE: This protects the mean-reversion strategy from regressing into a no-signal implementation.
  it('emits a buy below the lower band and a sell above the upper band', () => {
    // This series dips sharply and then rallies sharply to cross both Bollinger thresholds.
    const prices = [100, 101, 102, 103, 104, 90, 105, 115, 120];
    // A tight window and standard deviation make the band breaches deterministic.
    const signals = generateBollingerMeanReversion(prices, 3, 1);

    // The deep dip should produce a mean-reversion buy signal.
    expect(signals).toContain(1);
    // The later rally should produce the matching exit signal.
    expect(signals).toContain(-1);
  });

  // PURPOSE: This protects the breakout strategy’s combination of structure break and ATR confirmation.
  it('emits a breakout buy when price clears resistance with enough momentum', () => {
    // This long consolidation satisfies the implementation's built-in 20-candle warm-up requirement.
    const prices = [...Array(20).fill(100), 105, 110];
    // The breakout uses the default 20-period structure window and a compact ATR confirmation window.
    const signals = generateVolatilityBreakout(prices, 20, 14);

    // The sharp breakout should generate at least one entry signal.
    expect(signals).toContain(1);
  });
});
