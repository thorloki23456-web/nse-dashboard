import { blackScholesGreeks } from '@/lib/greeks';
import type { OptionChain, OptionStrike } from '@/lib/types';

const DEFAULT_RISK_FREE_RATE = 0.1;
const DEFAULT_VOLATILITY = 0.2;
const DEFAULT_TIME_TO_EXPIRY_YEARS = 7 / 365;
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

interface OptionLegLike {
  openInterest?: number;
  changeinOpenInterest?: number;
  totalTradedVolume?: number;
  lastPrice?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  vega?: number;
  greeks?: {
    delta?: number;
    gamma?: number;
    vega?: number;
  };
}

export interface GammaFlipResult {
  flipStrike: number | null;
  flipPct: number;
  regime: 'above' | 'below' | 'at' | 'unknown';
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extractStrikes(chain: OptionChain): OptionStrike[] {
  const candidate = chain as unknown as { data?: OptionStrike[]; strikes?: OptionStrike[] };

  if (Array.isArray(candidate.data)) {
    return candidate.data;
  }

  if (Array.isArray(candidate.strikes)) {
    return candidate.strikes;
  }

  return [];
}

function extractUnderlying(chain: OptionChain, strikes: OptionStrike[]): number {
  const candidate = chain as unknown as { underlyingValue?: number; spot?: number };
  const direct = toFiniteNumber(candidate.underlyingValue, 0) || toFiniteNumber(candidate.spot, 0);

  if (direct > 0) {
    return direct;
  }

  if (strikes.length === 0) {
    return 0;
  }

  // Fallback to median strike if spot is unavailable.
  const ordered = [...strikes].sort((a, b) => getStrikePrice(a) - getStrikePrice(b));
  const middle = ordered[Math.floor(ordered.length / 2)];
  return getStrikePrice(middle);
}

function extractContractMultiplier(chain: OptionChain): number {
  const candidate = chain as unknown as {
    contractMultiplier?: number;
    lotSize?: number;
    multiplier?: number;
  };

  return Math.max(
    1,
    toFiniteNumber(candidate.contractMultiplier, 0) ||
      toFiniteNumber(candidate.lotSize, 0) ||
      toFiniteNumber(candidate.multiplier, 0) ||
      1
  );
}

function getStrikePrice(strike: OptionStrike): number {
  const candidate = strike as unknown as { strikePrice?: number; strike?: number };
  return toFiniteNumber(candidate.strikePrice, toFiniteNumber(candidate.strike, 0));
}

function getExpiryTimestamp(strike: OptionStrike, chain: OptionChain): number | null {
  const strikeCandidate = strike as unknown as { expiryDate?: string };
  const chainCandidate = chain as unknown as { expiryDate?: string };
  const expiry = strikeCandidate.expiryDate ?? chainCandidate.expiryDate;

  if (!expiry) {
    return null;
  }

  const ts = Date.parse(expiry);
  return Number.isFinite(ts) ? ts : null;
}

function timeToExpiryYears(strike: OptionStrike, chain: OptionChain): number {
  const expiryTs = getExpiryTimestamp(strike, chain);

  if (!expiryTs) {
    return DEFAULT_TIME_TO_EXPIRY_YEARS;
  }

  const years = (expiryTs - Date.now()) / ONE_DAY_IN_MS / 365;
  return Math.max(1 / 365, years);
}

function getLeg(strike: OptionStrike, side: 'CE' | 'PE'): OptionLegLike | null {
  const candidate = strike as unknown as { CE?: OptionLegLike; PE?: OptionLegLike };
  return side === 'CE' ? candidate.CE ?? null : candidate.PE ?? null;
}

function getOpenInterest(leg: OptionLegLike | null): number {
  return Math.max(0, toFiniteNumber(leg?.openInterest, 0));
}

function getImpliedVolatility(leg: OptionLegLike | null): number {
  const iv = toFiniteNumber(leg?.impliedVolatility, 0);
  return iv > 1 ? iv / 100 : iv;
}

function getGreekFromLeg(leg: OptionLegLike | null, greek: 'delta' | 'gamma' | 'vega'): number {
  if (!leg) {
    return Number.NaN;
  }

  const direct = toFiniteNumber(leg[greek], Number.NaN);
  if (Number.isFinite(direct)) {
    return direct;
  }

  return toFiniteNumber(leg.greeks?.[greek], Number.NaN);
}

function computeFallbackGreeks(
  spot: number,
  strikePrice: number,
  iv: number,
  timeYears: number,
  isCall: boolean
): { delta: number; gamma: number; vega: number } {
  const sigma = iv > 0 ? iv : DEFAULT_VOLATILITY;
  const safeSpot = Math.max(spot, 1e-6);
  const safeStrike = Math.max(strikePrice, 1e-6);
  const safeT = Math.max(timeYears, 1 / 365);
  const bs = blackScholesGreeks(
    safeSpot,
    safeStrike,
    safeT,
    DEFAULT_RISK_FREE_RATE,
    sigma,
    isCall
  );

  return {
    delta: bs.delta,
    gamma: Math.max(0, bs.gamma),
    vega: Math.max(0, bs.vega),
  };
}

function resolveDelta(
  leg: OptionLegLike | null,
  spot: number,
  strikePrice: number,
  timeYears: number,
  isCall: boolean
): number {
  const rawDelta = getGreekFromLeg(leg, 'delta');
  if (Number.isFinite(rawDelta)) {
    return clamp(rawDelta, -1, 1);
  }

  const fallback = computeFallbackGreeks(
    spot,
    strikePrice,
    getImpliedVolatility(leg),
    timeYears,
    isCall
  ).delta;

  return clamp(fallback, -1, 1);
}

function resolveGamma(
  leg: OptionLegLike | null,
  spot: number,
  strikePrice: number,
  timeYears: number,
  isCall: boolean
): number {
  const rawGamma = getGreekFromLeg(leg, 'gamma');
  if (Number.isFinite(rawGamma) && rawGamma >= 0) {
    return rawGamma;
  }

  return computeFallbackGreeks(
    spot,
    strikePrice,
    getImpliedVolatility(leg),
    timeYears,
    isCall
  ).gamma;
}

function resolveVega(
  leg: OptionLegLike | null,
  spot: number,
  strikePrice: number,
  timeYears: number,
  isCall: boolean
): number {
  const rawVega = getGreekFromLeg(leg, 'vega');
  if (Number.isFinite(rawVega) && rawVega >= 0) {
    return rawVega;
  }

  return computeFallbackGreeks(
    spot,
    strikePrice,
    getImpliedVolatility(leg),
    timeYears,
    isCall
  ).vega;
}

function normalizeExposure(net: number, gross: number): number {
  if (!Number.isFinite(net) || !Number.isFinite(gross) || gross <= 0) {
    return 0;
  }

  return clamp((net / gross) * 100, -100, 100);
}

function netGammaExposureByStrike(
  strike: OptionStrike,
  chain: OptionChain,
  spot: number,
  contractMultiplier: number
): { strike: number; exposure: number } {
  const strikePrice = getStrikePrice(strike);
  const timeYears = timeToExpiryYears(strike, chain);
  const call = getLeg(strike, 'CE');
  const put = getLeg(strike, 'PE');

  const callOI = getOpenInterest(call);
  const putOI = getOpenInterest(put);
  const callGamma = resolveGamma(call, spot, strikePrice, timeYears, true);
  const putGamma = resolveGamma(put, spot, strikePrice, timeYears, false);

  // Exposure scaling mirrors common desk conventions (S^2 * 1% move).
  const callExposure = callGamma * callOI * contractMultiplier * spot * spot * 0.01;
  const putExposure = putGamma * putOI * contractMultiplier * spot * spot * 0.01;

  return {
    strike: strikePrice,
    exposure: callExposure - putExposure,
  };
}

export function calculateGEX(chain: OptionChain): number {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return 0;
  }

  const spot = extractUnderlying(chain, strikes);
  const contractMultiplier = extractContractMultiplier(chain);

  let net = 0;
  let gross = 0;

  for (const strike of strikes) {
    const data = netGammaExposureByStrike(strike, chain, spot, contractMultiplier);
    net += data.exposure;
    gross += Math.abs(data.exposure);
  }

  return normalizeExposure(net, gross);
}

export function calculateGammaFlip(chain: OptionChain): GammaFlipResult {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return { flipStrike: null, flipPct: 0, regime: 'unknown' };
  }

  const spot = extractUnderlying(chain, strikes);
  const contractMultiplier = extractContractMultiplier(chain);
  const curve = strikes
    .map((strike) => netGammaExposureByStrike(strike, chain, spot, contractMultiplier))
    .sort((a, b) => a.strike - b.strike);

  let cumulative = 0;
  let prevCumulative = 0;
  let prevStrike = curve[0]?.strike ?? 0;
  let flipStrike: number | null = null;

  for (const point of curve) {
    prevCumulative = cumulative;
    cumulative += point.exposure;

    const signChanged = (prevCumulative <= 0 && cumulative > 0) || (prevCumulative >= 0 && cumulative < 0);
    if (!signChanged) {
      prevStrike = point.strike;
      continue;
    }

    const slope = cumulative - prevCumulative;
    if (slope === 0) {
      flipStrike = point.strike;
    } else {
      const ratio = -prevCumulative / slope;
      flipStrike = prevStrike + (point.strike - prevStrike) * clamp(ratio, 0, 1);
    }
    break;
  }

  if (flipStrike === null) {
    return { flipStrike: null, flipPct: 0, regime: 'unknown' };
  }

  const flipPct = spot > 0 ? ((spot - flipStrike) / spot) * 100 : 0;
  const regime: GammaFlipResult['regime'] =
    Math.abs(flipPct) < 0.05 ? 'at' : flipPct > 0 ? 'above' : 'below';

  return {
    flipStrike,
    flipPct: Number(flipPct.toFixed(4)),
    regime,
  };
}

export function calculateDEX(chain: OptionChain): number {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return 0;
  }

  const spot = extractUnderlying(chain, strikes);
  const contractMultiplier = extractContractMultiplier(chain);

  let net = 0;
  let gross = 0;

  for (const strike of strikes) {
    const strikePrice = getStrikePrice(strike);
    const timeYears = timeToExpiryYears(strike, chain);
    const call = getLeg(strike, 'CE');
    const put = getLeg(strike, 'PE');

    const callOI = getOpenInterest(call);
    const putOI = getOpenInterest(put);
    const callDelta = resolveDelta(call, spot, strikePrice, timeYears, true);
    const putDelta = resolveDelta(put, spot, strikePrice, timeYears, false);

    const callExposure = callDelta * callOI * contractMultiplier * spot;
    const putExposure = putDelta * putOI * contractMultiplier * spot;

    net += callExposure + putExposure;
    gross += Math.abs(callExposure) + Math.abs(putExposure);
  }

  return normalizeExposure(net, gross);
}

export function calculateIVSkew(chain: OptionChain): number {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return 0;
  }

  let callWeightedIV = 0;
  let callWeight = 0;
  let putWeightedIV = 0;
  let putWeight = 0;

  for (const strike of strikes) {
    const call = getLeg(strike, 'CE');
    const put = getLeg(strike, 'PE');

    const callIV = getImpliedVolatility(call);
    const putIV = getImpliedVolatility(put);
    const callOI = getOpenInterest(call);
    const putOI = getOpenInterest(put);

    if (callIV > 0 && callOI > 0) {
      callWeightedIV += callIV * callOI;
      callWeight += callOI;
    }

    if (putIV > 0 && putOI > 0) {
      putWeightedIV += putIV * putOI;
      putWeight += putOI;
    }
  }

  const callAvg = callWeight > 0 ? callWeightedIV / callWeight : 0;
  const putAvg = putWeight > 0 ? putWeightedIV / putWeight : 0;
  const skewPoints = (callAvg - putAvg) * 100;

  return Number(skewPoints.toFixed(4));
}

export function calculateVegaExposure(chain: OptionChain): number {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return 0;
  }

  const spot = extractUnderlying(chain, strikes);
  const contractMultiplier = extractContractMultiplier(chain);
  let net = 0;
  let gross = 0;

  for (const strike of strikes) {
    const strikePrice = getStrikePrice(strike);
    const timeYears = timeToExpiryYears(strike, chain);
    const call = getLeg(strike, 'CE');
    const put = getLeg(strike, 'PE');
    const callOI = getOpenInterest(call);
    const putOI = getOpenInterest(put);

    const callVega = resolveVega(call, spot, strikePrice, timeYears, true);
    const putVega = resolveVega(put, spot, strikePrice, timeYears, false);

    const callExposure = callVega * callOI * contractMultiplier;
    const putExposure = putVega * putOI * contractMultiplier;

    net += callExposure - putExposure;
    gross += Math.abs(callExposure) + Math.abs(putExposure);
  }

  return normalizeExposure(net, gross);
}

export function calculateOIImbalance(chain: OptionChain): number {
  const strikes = extractStrikes(chain);
  if (strikes.length === 0) {
    return 0;
  }

  const spot = extractUnderlying(chain, strikes);
  let weightedCallOI = 0;
  let weightedPutOI = 0;

  for (const strike of strikes) {
    const strikePrice = getStrikePrice(strike);
    const timeYears = timeToExpiryYears(strike, chain);
    const call = getLeg(strike, 'CE');
    const put = getLeg(strike, 'PE');

    const callOI = getOpenInterest(call);
    const putOI = getOpenInterest(put);
    const callDelta = Math.abs(resolveDelta(call, spot, strikePrice, timeYears, true));
    const putDelta = Math.abs(resolveDelta(put, spot, strikePrice, timeYears, false));

    weightedCallOI += callOI * callDelta;
    weightedPutOI += putOI * putDelta;
  }

  const total = weightedCallOI + weightedPutOI;
  if (total <= 0) {
    return 0;
  }

  return Number((((weightedCallOI - weightedPutOI) / total) * 100).toFixed(4));
}

export function calculateUVR(volume: number, avgVolume: number): number {
  const safeVolume = Math.max(0, toFiniteNumber(volume, 0));
  const safeAvg = Math.max(0, toFiniteNumber(avgVolume, 0));

  if (safeAvg <= 0) {
    return 0;
  }

  return Number((safeVolume / safeAvg).toFixed(4));
}
