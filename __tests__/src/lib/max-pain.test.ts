import { calculateMaxPain, calculatePCR, calculateIVSkewByStrike, calculateGEXByStrike } from '@/lib/max-pain';
import type { OptionChain } from '@/lib/types';

function makeChain(strikes: { k: number; ceOI: number; peOI: number; ceIV?: number; peIV?: number }[]): OptionChain {
  return {
    symbol: 'TEST',
    underlyingValue: 100,
    data: strikes.map((s) => ({
      strikePrice: s.k,
      CE: { openInterest: s.ceOI, changeinOpenInterest: 0, totalTradedVolume: 0, lastPrice: 0, impliedVolatility: s.ceIV ?? 20 },
      PE: { openInterest: s.peOI, changeinOpenInterest: 0, totalTradedVolume: 0, lastPrice: 0, impliedVolatility: s.peIV ?? 25 },
    })),
  } as unknown as OptionChain;
}

describe('calculateMaxPain', () => {
  it('returns 0 for empty chain', () => {
    const chain = { symbol: 'X', underlyingValue: 0, data: [] } as unknown as OptionChain;
    expect(calculateMaxPain(chain).maxPainStrike).toBe(0);
  });

  it('identifies the strike with minimum total payout', () => {
    // Heavy CE OI at 110 → expiry at 110 forces large call payout at lower strikes
    // Heavy PE OI at 90 → expiry at 90 forces large put payout at higher strikes
    // Max pain should be near 100 (balanced)
    const chain = makeChain([
      { k: 90, ceOI: 100, peOI: 5000 },
      { k: 100, ceOI: 200, peOI: 200 },
      { k: 110, ceOI: 5000, peOI: 100 },
    ]);
    const { maxPainStrike } = calculateMaxPain(chain);
    expect(maxPainStrike).toBe(100);
  });

  it('returns payoutByStrike with correct length', () => {
    const chain = makeChain([
      { k: 95, ceOI: 100, peOI: 100 },
      { k: 100, ceOI: 200, peOI: 200 },
      { k: 105, ceOI: 100, peOI: 100 },
    ]);
    const { payoutByStrike } = calculateMaxPain(chain);
    expect(payoutByStrike).toHaveLength(3);
  });
});

describe('calculatePCR', () => {
  it('returns 0 for empty chain', () => {
    const chain = { symbol: 'X', underlyingValue: 0, data: [] } as unknown as OptionChain;
    expect(calculatePCR(chain)).toBe(0);
  });

  it('calculates PCR correctly', () => {
    const chain = makeChain([
      { k: 100, ceOI: 1000, peOI: 1500 },
      { k: 105, ceOI: 500, peOI: 500 },
    ]);
    // totalPeOI = 2000, totalCeOI = 1500 → PCR = 2000/1500 ≈ 1.3333
    expect(calculatePCR(chain)).toBeCloseTo(1.3333, 3);
  });
});

describe('calculateIVSkewByStrike', () => {
  it('returns empty array for empty chain', () => {
    const chain = { symbol: 'X', underlyingValue: 0, data: [] } as unknown as OptionChain;
    expect(calculateIVSkewByStrike(chain)).toHaveLength(0);
  });

  it('computes skew as callIV - putIV', () => {
    const chain = makeChain([{ k: 100, ceOI: 100, peOI: 100, ceIV: 20, peIV: 25 }]);
    const result = calculateIVSkewByStrike(chain);
    expect(result).toHaveLength(1);
    expect(result[0].skew).toBeCloseTo(-5, 1);
  });

  it('normalises IV > 1 (percentage form) correctly', () => {
    const chain = makeChain([{ k: 100, ceOI: 100, peOI: 100, ceIV: 0.20, peIV: 0.25 }]);
    const result = calculateIVSkewByStrike(chain);
    // 0.20 → treated as decimal, multiplied by 100 → 20
    expect(result[0].callIV).toBeCloseTo(20, 1);
  });
});

describe('calculateGEXByStrike', () => {
  it('returns empty array for empty chain', () => {
    const chain = { symbol: 'X', underlyingValue: 0, data: [] } as unknown as OptionChain;
    expect(calculateGEXByStrike(chain)).toHaveLength(0);
  });

  it('marks positive GEX when ceOI > peOI', () => {
    const chain = makeChain([{ k: 100, ceOI: 5000, peOI: 1000 }]);
    (chain as unknown as { underlyingValue: number }).underlyingValue = 100;
    const result = calculateGEXByStrike(chain);
    expect(result[0].side).toBe('positive');
    expect(result[0].gex).toBeGreaterThan(0);
  });

  it('marks negative GEX when peOI > ceOI', () => {
    const chain = makeChain([{ k: 100, ceOI: 1000, peOI: 5000 }]);
    (chain as unknown as { underlyingValue: number }).underlyingValue = 100;
    const result = calculateGEXByStrike(chain);
    expect(result[0].side).toBe('negative');
    expect(result[0].gex).toBeLessThan(0);
  });
});
