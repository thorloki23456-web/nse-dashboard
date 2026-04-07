import type { OptionChain, OptionStrike } from './types';

function getStrikePrice(s: OptionStrike): number {
  return (s as unknown as { strikePrice?: number }).strikePrice ?? 0;
}

function getOI(s: OptionStrike, side: 'CE' | 'PE'): number {
  const leg = side === 'CE' ? s.CE : s.PE;
  return Math.max(0, (leg as unknown as { openInterest?: number })?.openInterest ?? 0);
}

/**
 * Max Pain: the strike at which total option buyers lose the most money
 * (i.e., where total payout to option holders is minimised).
 */
export function calculateMaxPain(chain: OptionChain): {
  maxPainStrike: number;
  payoutByStrike: { strike: number; totalPayout: number }[];
} {
  const strikes = (chain as unknown as { data?: OptionStrike[] }).data ?? [];
  if (strikes.length === 0) return { maxPainStrike: 0, payoutByStrike: [] };

  const strikePrices = strikes.map(getStrikePrice).filter((p) => p > 0);

  const payoutByStrike = strikePrices.map((expiry) => {
    let totalPayout = 0;
    for (const s of strikes) {
      const k = getStrikePrice(s);
      const ceOI = getOI(s, 'CE');
      const peOI = getOI(s, 'PE');
      // Call payout at expiry price
      if (expiry > k) totalPayout += (expiry - k) * ceOI;
      // Put payout at expiry price
      if (expiry < k) totalPayout += (k - expiry) * peOI;
    }
    return { strike: expiry, totalPayout };
  });

  const minPayout = Math.min(...payoutByStrike.map((p) => p.totalPayout));
  const maxPainEntry = payoutByStrike.find((p) => p.totalPayout === minPayout);

  return {
    maxPainStrike: maxPainEntry?.strike ?? 0,
    payoutByStrike,
  };
}

/**
 * Put-Call Ratio (OI-based)
 */
export function calculatePCR(chain: OptionChain): number {
  const strikes = (chain as unknown as { data?: OptionStrike[] }).data ?? [];
  let totalCeOI = 0;
  let totalPeOI = 0;
  for (const s of strikes) {
    totalCeOI += getOI(s, 'CE');
    totalPeOI += getOI(s, 'PE');
  }
  if (totalCeOI === 0) return 0;
  return Number((totalPeOI / totalCeOI).toFixed(4));
}

/**
 * IV Skew: per-strike call IV minus put IV, for charting.
 */
export function calculateIVSkewByStrike(chain: OptionChain): {
  strike: number;
  callIV: number;
  putIV: number;
  skew: number;
}[] {
  const strikes = (chain as unknown as { data?: OptionStrike[] }).data ?? [];
  return strikes
    .map((s) => {
      const k = getStrikePrice(s);
      const rawCallIV = (s.CE as unknown as { impliedVolatility?: number })?.impliedVolatility ?? 0;
      const rawPutIV = (s.PE as unknown as { impliedVolatility?: number })?.impliedVolatility ?? 0;
      const callIV = rawCallIV > 1 ? rawCallIV : rawCallIV * 100;
      const putIV = rawPutIV > 1 ? rawPutIV : rawPutIV * 100;
      return { strike: k, callIV, putIV, skew: callIV - putIV };
    })
    .filter((r) => r.strike > 0 && (r.callIV > 0 || r.putIV > 0));
}

/**
 * GEX by strike for bar chart visualisation.
 */
export function calculateGEXByStrike(
  chain: OptionChain
): { strike: number; gex: number; side: 'positive' | 'negative' }[] {
  const strikes = (chain as unknown as { data?: OptionStrike[] }).data ?? [];
  const spot = (chain as unknown as { underlyingValue?: number }).underlyingValue ?? 0;

  return strikes
    .map((s) => {
      const k = getStrikePrice(s);
      const ceOI = getOI(s, 'CE');
      const peOI = getOI(s, 'PE');
      // Simplified GEX proxy: (ceOI - peOI) * spot / 1e7
      const gex = ((ceOI - peOI) * spot) / 1e7;
      return { strike: k, gex: Number(gex.toFixed(2)), side: gex >= 0 ? ('positive' as const) : ('negative' as const) };
    })
    .filter((r) => r.strike > 0);
}
