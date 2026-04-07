import {
  calculateDEX,
  calculateGEX,
  calculateGammaFlip,
  calculateIVSkew,
  calculateOIImbalance,
  calculateUVR,
  calculateVegaExposure,
} from '@/lib/signals';
import { computeConfluence, normalizeSignal } from '@/lib/confluence-engine';
import type {
  ConfluenceResult,
  OptionChain,
  OptionStrike,
  SignalScore,
} from '@/lib/types';

export interface LiveOptionLegInput {
  openInterest?: number;
  changeinOpenInterest?: number;
  totalTradedVolume?: number;
  lastPrice?: number;
  impliedVolatility?: number;
}

export interface LiveOptionStrikeInput {
  strikePrice: number;
  expiryDate?: string;
  CE?: LiveOptionLegInput;
  PE?: LiveOptionLegInput;
}

export interface TechnicalSnapshot {
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  currentTrend: 'up' | 'down' | 'none';
  currentRSI: number;
  currentATR: number;
  superTrendValue: number;
}

export interface AnalyticsContext {
  strategy?:
    | 'momentum'
    | 'meanrev'
    | 'gamma'
    | 'vol_expand'
    | 'pin_trade'
    | 'uoa_follow';
  avgVolume?: number;
  volumeHistory?: number[];
  ivRank?: number;
  ivRange?: {
    low: number;
    high: number;
  };
  ltpVsVwapPct?: number;
  vpin?: number;
  riskFreeRate?: number;
  daysToExpiry?: number;
}

export interface BuildAnalyticsInput {
  symbol: string;
  expiryDate: string;
  timestamp?: string;
  underlyingValue: number;
  strikes: LiveOptionStrikeInput[];
  technical?: TechnicalSnapshot | null;
  context?: AnalyticsContext;
}

export interface DerivedSignalMetrics {
  gex: number;
  gammaFlip: number;
  dex: number;
  ivSkew: number;
  vegaExposure: number;
  oiImbalance: number;
  uvr: number;
  totalVolume: number;
  avgVolume: number;
  ltpVsVwapPct: number;
  ivRank: number;
  vpin: number;
}

export interface AnalyticsSnapshot {
  chain: OptionChain;
  metrics: DerivedSignalMetrics;
  signalScores: SignalScore[];
  confluence: ConfluenceResult;
}

const DEFAULT_CONTEXT: Required<
  Pick<AnalyticsContext, 'strategy' | 'vpin' | 'riskFreeRate' | 'daysToExpiry'>
> = {
  strategy: 'momentum',
  vpin: 25,
  riskFreeRate: 0.1,
  daysToExpiry: 7,
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function asNumericSignal(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const candidate = (value as { value?: unknown }).value;
    return toFiniteNumber(candidate, 0);
  }

  return 0;
}

function normalizeLeg(leg?: LiveOptionLegInput) {
  if (!leg) {
    return undefined;
  }

  return {
    openInterest: Math.max(0, toFiniteNumber(leg.openInterest, 0)),
    changeinOpenInterest: toFiniteNumber(leg.changeinOpenInterest, 0),
    totalTradedVolume: Math.max(0, toFiniteNumber(leg.totalTradedVolume, 0)),
    lastPrice: Math.max(0, toFiniteNumber(leg.lastPrice, 0)),
    impliedVolatility: Math.max(0, toFiniteNumber(leg.impliedVolatility, 0)),
  };
}

function normalizeStrike(strike: LiveOptionStrikeInput): OptionStrike {
  return {
    strikePrice: toFiniteNumber(strike.strikePrice, 0),
    expiryDate: strike.expiryDate ?? '',
    CE: normalizeLeg(strike.CE),
    PE: normalizeLeg(strike.PE),
  } as OptionStrike;
}

function createChainSnapshot(input: BuildAnalyticsInput): OptionChain {
  const normalizedStrikes = (input.strikes ?? [])
    .map(normalizeStrike)
    .sort((a, b) => toFiniteNumber(a.strikePrice, 0) - toFiniteNumber(b.strikePrice, 0));

  return {
    symbol: input.symbol,
    expiryDate: input.expiryDate,
    timestamp: input.timestamp ?? '',
    underlyingValue: toFiniteNumber(input.underlyingValue, 0),
    data: normalizedStrikes,
  } as OptionChain;
}

function computeTotalVolume(strikes: OptionStrike[]): number {
  return strikes.reduce((acc, strike) => {
    const ceVolume = toFiniteNumber(strike.CE?.totalTradedVolume, 0);
    const peVolume = toFiniteNumber(strike.PE?.totalTradedVolume, 0);
    return acc + ceVolume + peVolume;
  }, 0);
}

function computeAverageVolume(totalVolume: number, context?: AnalyticsContext): number {
  if (typeof context?.avgVolume === 'number' && context.avgVolume > 0) {
    return context.avgVolume;
  }

  const history = (context?.volumeHistory ?? []).filter((v) => Number.isFinite(v) && v > 0);
  if (history.length > 0) {
    const sum = history.reduce((acc, value) => acc + value, 0);
    return sum / history.length;
  }

  return totalVolume > 0 ? totalVolume : 1;
}

function findNearestStrike(strikes: OptionStrike[], underlyingValue: number): OptionStrike | null {
  if (strikes.length === 0) {
    return null;
  }

  let nearest = strikes[0];
  let bestDistance = Math.abs(toFiniteNumber(nearest.strikePrice, 0) - underlyingValue);

  for (let i = 1; i < strikes.length; i += 1) {
    const candidate = strikes[i];
    const distance = Math.abs(toFiniteNumber(candidate.strikePrice, 0) - underlyingValue);
    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }

  return nearest;
}

function estimateLtpVsVwapPct(chain: OptionChain, context?: AnalyticsContext): number {
  if (typeof context?.ltpVsVwapPct === 'number' && Number.isFinite(context.ltpVsVwapPct)) {
    return context.ltpVsVwapPct;
  }

  const strikes = ((chain as unknown as { data?: OptionStrike[] }).data ?? []) as OptionStrike[];
  const underlyingValue = toFiniteNumber((chain as unknown as { underlyingValue?: number }).underlyingValue, 0);
  if (strikes.length === 0 || underlyingValue <= 0) {
    return 0;
  }

  const nearest = findNearestStrike(strikes, underlyingValue);
  if (!nearest) {
    return 0;
  }

  const cePrice = toFiniteNumber(nearest.CE?.lastPrice, 0);
  const pePrice = toFiniteNumber(nearest.PE?.lastPrice, 0);
  const syntheticForward = toFiniteNumber(nearest.strikePrice, 0) + cePrice - pePrice;
  if (syntheticForward <= 0) {
    return 0;
  }

  return ((underlyingValue - syntheticForward) / syntheticForward) * 100;
}

function estimateCurrentIv(chain: OptionChain): number {
  const strikes = ((chain as unknown as { data?: OptionStrike[] }).data ?? []) as OptionStrike[];
  if (strikes.length === 0) {
    return 0;
  }

  let weightedIvSum = 0;
  let totalOi = 0;

  for (const strike of strikes) {
    const ceIv = toFiniteNumber(strike.CE?.impliedVolatility, 0);
    const peIv = toFiniteNumber(strike.PE?.impliedVolatility, 0);
    const ceOi = toFiniteNumber(strike.CE?.openInterest, 0);
    const peOi = toFiniteNumber(strike.PE?.openInterest, 0);

    weightedIvSum += ceIv * ceOi + peIv * peOi;
    totalOi += ceOi + peOi;
  }

  if (totalOi <= 0) {
    return 0;
  }

  return weightedIvSum / totalOi;
}

function estimateIvRank(chain: OptionChain, context?: AnalyticsContext): number {
  if (typeof context?.ivRank === 'number' && Number.isFinite(context.ivRank)) {
    return clamp(context.ivRank, 0, 100);
  }

  const iv = estimateCurrentIv(chain);
  const low = toFiniteNumber(context?.ivRange?.low, 10);
  const high = toFiniteNumber(context?.ivRange?.high, 80);
  const span = high - low;

  if (span <= 0) {
    return clamp(iv, 0, 100);
  }

  return clamp(((iv - low) / span) * 100, 0, 100);
}

function safeNormalize(value: number): number {
  try {
    const normalized = (normalizeSignal as unknown as (raw: number) => number)(value);
    if (Number.isFinite(normalized)) {
      return clamp(normalized, 0, 100);
    }
  } catch {
    // Fallback to internal normalization path.
  }

  return clamp(Math.abs(value), 0, 100);
}

function createSignalScore(
  key: string,
  value: number,
  bullishBias: boolean,
  weight: number,
  description: string
): SignalScore {
  const normalized = safeNormalize(value);
  const bullish = bullishBias ? normalized : 100 - normalized;
  const bearish = bullishBias ? 100 - normalized : normalized;

  return {
    key,
    value,
    normalized,
    bullish,
    bearish,
    weight,
    description,
  } as unknown as SignalScore;
}

export function deriveSignalMetrics(chain: OptionChain, context?: AnalyticsContext): DerivedSignalMetrics {
  const strikes = ((chain as unknown as { data?: OptionStrike[] }).data ?? []) as OptionStrike[];
  const totalVolume = computeTotalVolume(strikes);
  const avgVolume = computeAverageVolume(totalVolume, context);

  const gex = asNumericSignal(calculateGEX(chain));
  const gammaFlip = asNumericSignal(calculateGammaFlip(chain));
  const dex = asNumericSignal(calculateDEX(chain));
  const ivSkew = asNumericSignal(calculateIVSkew(chain));
  const vegaExposure = asNumericSignal(calculateVegaExposure(chain));
  const oiImbalance = asNumericSignal(calculateOIImbalance(chain));
  const uvr = asNumericSignal(calculateUVR(totalVolume, avgVolume));

  return {
    gex,
    gammaFlip,
    dex,
    ivSkew,
    vegaExposure,
    oiImbalance,
    uvr,
    totalVolume,
    avgVolume,
    ltpVsVwapPct: estimateLtpVsVwapPct(chain, context),
    ivRank: estimateIvRank(chain, context),
    vpin: clamp(toFiniteNumber(context?.vpin, DEFAULT_CONTEXT.vpin), 0, 100),
  };
}

export function buildSignalScores(
  metrics: DerivedSignalMetrics,
  technical?: TechnicalSnapshot | null
): SignalScore[] {
  const technicalBias = technical
    ? technical.signal === 'BUY'
      ? 1
      : technical.signal === 'SELL'
        ? -1
        : 0
    : 0;

  const scores: SignalScore[] = [
    createSignalScore('gex', metrics.gex, metrics.gex >= 0, 1.1, 'Gamma exposure regime'),
    createSignalScore('gammaFlip', metrics.gammaFlip, metrics.gammaFlip >= 0, 1.15, 'Dealer gamma flip positioning'),
    createSignalScore('dex', metrics.dex, metrics.dex >= 0, 1.0, 'Net delta exposure'),
    createSignalScore('ivSkew', metrics.ivSkew, metrics.ivSkew <= 0, 0.85, 'Put-call volatility skew'),
    createSignalScore('vegaExposure', metrics.vegaExposure, metrics.vegaExposure >= 0, 0.9, 'Net vega positioning'),
    createSignalScore('oiImbalance', metrics.oiImbalance, metrics.oiImbalance >= 0, 1.2, 'Delta-weighted open interest imbalance'),
    createSignalScore('uvr', metrics.uvr, metrics.uvr >= 1, 1.25, 'Unusual volume ratio'),
    createSignalScore('ivRank', metrics.ivRank - 50, metrics.ivRank < 30, 0.8, 'Relative implied-volatility rank'),
    createSignalScore('vpin', 100 - metrics.vpin, metrics.vpin < 60, 0.95, 'Order-flow toxicity filter'),
    createSignalScore(
      'ltpVsVwap',
      metrics.ltpVsVwapPct,
      metrics.ltpVsVwapPct >= 0,
      0.9,
      'Underlying relative to synthetic options VWAP proxy'
    ),
  ];

  if (technicalBias !== 0) {
    scores.push(
      createSignalScore(
        'technicalBias',
        technicalBias * 100,
        technicalBias > 0,
        0.75,
        'SuperTrend and RSI directional bias'
      )
    );
  }

  return scores;
}

function safeConfluence(input: {
  chain: OptionChain;
  strategy: string;
  signalScores: SignalScore[];
  metrics: DerivedSignalMetrics;
  technical?: TechnicalSnapshot | null;
}): ConfluenceResult {
  const runtimeComputeConfluence = computeConfluence as unknown as (payload: unknown) => ConfluenceResult;

  try {
    return runtimeComputeConfluence(input);
  } catch {
    // Defensive fallback keeps the analytics pipeline stable if engine signature changes.
    const weighted = input.signalScores.reduce(
      (acc, score) => {
        const normalized = toFiniteNumber((score as unknown as { normalized?: number }).normalized, 50);
        const weight = Math.max(0.1, toFiniteNumber((score as unknown as { weight?: number }).weight, 1));
        acc.totalWeight += weight;
        acc.bullish += normalized * weight;
        acc.bearish += (100 - normalized) * weight;
        return acc;
      },
      { bullish: 0, bearish: 0, totalWeight: 0 }
    );

    const bullishScore = weighted.totalWeight > 0 ? weighted.bullish / weighted.totalWeight : 50;
    const bearishScore = weighted.totalWeight > 0 ? weighted.bearish / weighted.totalWeight : 50;
    const spread = bullishScore - bearishScore;
    const regime = spread > 8 ? 'LONG' : spread < -8 ? 'SHORT' : 'NEUTRAL';

    return {
      bullishScore: Math.round(clamp(bullishScore, 0, 100)),
      bearishScore: Math.round(clamp(bearishScore, 0, 100)),
      regime,
      confidence: Math.round(clamp(Math.abs(spread), 0, 100)),
      breakdown: input.signalScores,
    } as unknown as ConfluenceResult;
  }
}

export function buildAnalyticsSnapshot(input: BuildAnalyticsInput): AnalyticsSnapshot {
  const chain = createChainSnapshot(input);
  const strategy = input.context?.strategy ?? DEFAULT_CONTEXT.strategy;
  const metrics = deriveSignalMetrics(chain, input.context);
  const signalScores = buildSignalScores(metrics, input.technical ?? null);

  const confluence = safeConfluence({
    chain,
    strategy,
    signalScores,
    metrics,
    technical: input.technical ?? null,
  });

  return {
    chain,
    metrics,
    signalScores,
    confluence,
  };
}

export function updateVolumeHistory(
  previousHistory: number[],
  snapshot: AnalyticsSnapshot,
  maxPoints = 50
): number[] {
  const next = [...previousHistory, snapshot.metrics.totalVolume].filter(
    (value) => Number.isFinite(value) && value >= 0
  );

  if (next.length <= maxPoints) {
    return next;
  }

  return next.slice(next.length - maxPoints);
}

