import { computeConfluence, normalizeSignal } from '@/lib/confluence-engine';
import { blackScholesGreeks } from '@/lib/greeks';
import {
  calculateDEX,
  calculateGEX,
  calculateGammaFlip,
  calculateIVSkew,
  calculateOIImbalance,
  calculateUVR,
  calculateVegaExposure,
} from '@/lib/signals';
import type {
  AnalyticsContext,
  AnalyticsSnapshot,
  OptionChain,
  OptionLeg,
  OptionStrike,
  SignalMetrics,
  SignalScore,
  TechnicalAnalysisSnapshot,
} from '@/lib/types';

export type LiveOptionLegInput = Partial<OptionLeg>;

export interface LiveOptionStrikeInput {
  strikePrice: number;
  expiryDate?: string;
  CE?: LiveOptionLegInput;
  PE?: LiveOptionLegInput;
}

export interface BuildAnalyticsInput {
  symbol: string;
  expiryDate: string;
  timestamp?: string;
  underlyingValue: number;
  strikes: LiveOptionStrikeInput[];
  context?: AnalyticsContext;
  technical?: TechnicalAnalysisSnapshot | null;
}

export type DerivedSignalMetrics = SignalMetrics;
export type { AnalyticsContext };

type GammaFlipPayload =
  | number
  | {
      flipPct?: number;
      flipStrike?: number | null;
      regime?: string;
    };

const DEFAULT_RISK_FREE_RATE = 0.1;
const DEFAULT_LOT_SIZE = 50;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value: unknown, fallback = 0) {
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

function normalizeLeg(leg?: LiveOptionLegInput): OptionLeg | undefined {
  if (!leg) {
    return undefined;
  }

  return {
    openInterest: Math.max(0, toFiniteNumber(leg.openInterest)),
    changeinOpenInterest: toFiniteNumber(leg.changeinOpenInterest),
    totalTradedVolume: Math.max(0, toFiniteNumber(leg.totalTradedVolume)),
    lastPrice: Math.max(0, toFiniteNumber(leg.lastPrice)),
    impliedVolatility: Math.max(0, toFiniteNumber(leg.impliedVolatility)),
    change: toFiniteNumber(leg.change, 0),
    pChange: toFiniteNumber(leg.pChange, 0),
    delta: Number.isFinite(leg.delta) ? leg.delta : undefined,
    gamma: Number.isFinite(leg.gamma) ? leg.gamma : undefined,
    theta: Number.isFinite(leg.theta) ? leg.theta : undefined,
    vega: Number.isFinite(leg.vega) ? leg.vega : undefined,
    rho: Number.isFinite(leg.rho) ? leg.rho : undefined,
  };
}

function normalizeStrike(strike: LiveOptionStrikeInput): OptionStrike {
  return {
    strikePrice: toFiniteNumber(strike.strikePrice),
    expiryDate: strike.expiryDate,
    CE: normalizeLeg(strike.CE),
    PE: normalizeLeg(strike.PE),
  };
}

export function createOptionChain(input: BuildAnalyticsInput): OptionChain {
  return {
    symbol: input.symbol,
    expiryDate: input.expiryDate,
    timestamp: input.timestamp,
    underlyingValue: toFiniteNumber(input.underlyingValue),
    lotSize: input.context?.lotSize ?? DEFAULT_LOT_SIZE,
    data: [...input.strikes].map(normalizeStrike).sort((a, b) => a.strikePrice - b.strikePrice),
  };
}

function totalLegValue(strikes: OptionStrike[], side: 'CE' | 'PE', field: keyof OptionLeg) {
  return strikes.reduce((sum, strike) => sum + toFiniteNumber(strike[side]?.[field]), 0);
}

function computeTotalVolume(strikes: OptionStrike[]) {
  return strikes.reduce(
    (sum, strike) =>
      sum +
      toFiniteNumber(strike.CE?.totalTradedVolume) +
      toFiniteNumber(strike.PE?.totalTradedVolume),
    0
  );
}

function computeAverageVolume(totalVolume: number, context?: AnalyticsContext) {
  if (typeof context?.avgVolume === 'number' && context.avgVolume > 0) {
    return context.avgVolume;
  }

  const history = (context?.volumeHistory ?? []).filter((value) => Number.isFinite(value) && value > 0);
  if (history.length === 0) {
    return totalVolume || 1;
  }

  return history.reduce((sum, value) => sum + value, 0) / history.length;
}

function resolveGammaFlipValue(payload: GammaFlipPayload) {
  if (typeof payload === 'number') {
    return payload;
  }

  return toFiniteNumber(payload.flipPct, 0);
}

function findNearestStrike(strikes: OptionStrike[], underlyingValue: number) {
  return strikes.reduce<OptionStrike | null>((nearest, strike) => {
    if (!nearest) {
      return strike;
    }

    const currentDistance = Math.abs(strike.strikePrice - underlyingValue);
    const nearestDistance = Math.abs(nearest.strikePrice - underlyingValue);
    return currentDistance < nearestDistance ? strike : nearest;
  }, null);
}

function estimateLtpVsVwapPct(chain: OptionChain, context?: AnalyticsContext) {
  if (typeof context?.ltpVsVwapPct === 'number' && Number.isFinite(context.ltpVsVwapPct)) {
    return round(context.ltpVsVwapPct);
  }

  const nearest = findNearestStrike(chain.data, chain.underlyingValue);
  if (!nearest) {
    return 0;
  }

  const syntheticVwap = nearest.strikePrice + toFiniteNumber(nearest.CE?.lastPrice) - toFiniteNumber(nearest.PE?.lastPrice);
  if (syntheticVwap <= 0) {
    return 0;
  }

  return round(((chain.underlyingValue - syntheticVwap) / syntheticVwap) * 100);
}

function estimateIvRank(chain: OptionChain, context?: AnalyticsContext) {
  if (typeof context?.ivRank === 'number' && Number.isFinite(context.ivRank)) {
    return clamp(context.ivRank, 0, 100);
  }

  const totalWeightedIv = chain.data.reduce((sum, strike) => {
    return (
      sum +
      toFiniteNumber(strike.CE?.impliedVolatility) * toFiniteNumber(strike.CE?.openInterest) +
      toFiniteNumber(strike.PE?.impliedVolatility) * toFiniteNumber(strike.PE?.openInterest)
    );
  }, 0);
  const totalOi = totalLegValue(chain.data, 'CE', 'openInterest') + totalLegValue(chain.data, 'PE', 'openInterest');
  const currentIv = totalOi > 0 ? totalWeightedIv / totalOi : 0;
  const ivLow = context?.ivRange?.low ?? 10;
  const ivHigh = context?.ivRange?.high ?? 80;

  if (ivHigh <= ivLow) {
    return clamp(currentIv, 0, 100);
  }

  return round(clamp(((currentIv - ivLow) / (ivHigh - ivLow)) * 100, 0, 100), 2);
}

function calculateMaxPainDistance(chain: OptionChain) {
  if (chain.data.length === 0 || chain.underlyingValue <= 0) {
    return 0;
  }

  let minLoss = Number.POSITIVE_INFINITY;
  let maxPainStrike = chain.data[0].strikePrice;

  for (const candidate of chain.data) {
    const testStrike = candidate.strikePrice;
    let totalLoss = 0;

    for (const strike of chain.data) {
      const strikePrice = strike.strikePrice;
      if (testStrike > strikePrice) {
        totalLoss += toFiniteNumber(strike.CE?.openInterest) * (testStrike - strikePrice);
      }
      if (testStrike < strikePrice) {
        totalLoss += toFiniteNumber(strike.PE?.openInterest) * (strikePrice - testStrike);
      }
    }

    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainStrike = testStrike;
    }
  }

  return round(((maxPainStrike - chain.underlyingValue) / chain.underlyingValue) * 100);
}

function calculatePCR(chain: OptionChain) {
  const callOi = totalLegValue(chain.data, 'CE', 'openInterest');
  const putOi = totalLegValue(chain.data, 'PE', 'openInterest');

  if (callOi <= 0) {
    return 1;
  }

  return round(putOi / callOi);
}

function calculateThetaPressure(chain: OptionChain) {
  if (chain.data.length === 0 || chain.underlyingValue <= 0) {
    return 0;
  }

  const weightedTheta = chain.data.reduce((sum, strike) => {
    const timeToExpiryYears = Math.max(1 / 365, 7 / 365);
    const callIv = Math.max(0.01, toFiniteNumber(strike.CE?.impliedVolatility) / 100);
    const putIv = Math.max(0.01, toFiniteNumber(strike.PE?.impliedVolatility) / 100);

    const callTheta =
      strike.CE?.theta ??
      blackScholesGreeks(
        chain.underlyingValue,
        strike.strikePrice,
        timeToExpiryYears,
        DEFAULT_RISK_FREE_RATE,
        callIv,
        true
      ).theta;
    const putTheta =
      strike.PE?.theta ??
      blackScholesGreeks(
        chain.underlyingValue,
        strike.strikePrice,
        timeToExpiryYears,
        DEFAULT_RISK_FREE_RATE,
        putIv,
        false
      ).theta;

    return (
      sum +
      Math.abs(callTheta) * toFiniteNumber(strike.CE?.openInterest) +
      Math.abs(putTheta) * toFiniteNumber(strike.PE?.openInterest)
    );
  }, 0);

  const totalOi = totalLegValue(chain.data, 'CE', 'openInterest') + totalLegValue(chain.data, 'PE', 'openInterest');
  if (totalOi <= 0) {
    return 0;
  }

  return round(clamp((weightedTheta / totalOi) * 1000, 0, 100), 2);
}

function directionalAnchor(metrics: SignalMetrics) {
  return (
    metrics.gex / 100 +
    metrics.gammaFlip / 2 +
    metrics.dex / 100 +
    metrics.oiImbalance / 100 +
    metrics.netDelta -
    (metrics.pcr - 1.05) +
    metrics.maxPainDistance / 2 +
    metrics.ltpVsVwapPct / 2
  );
}

export function deriveSignalMetrics(chain: OptionChain, context?: AnalyticsContext): SignalMetrics {
  const totalVolume = computeTotalVolume(chain.data);
  const avgVolume = computeAverageVolume(totalVolume, context);
  const gex = round(calculateGEX(chain), 2);
  const gammaFlip = round(resolveGammaFlipValue(calculateGammaFlip(chain) as GammaFlipPayload), 4);
  const dex = round(calculateDEX(chain), 2);
  const oiImbalance = round(calculateOIImbalance(chain), 2);

  return {
    gex,
    gammaFlip,
    dex,
    ivSkew: round(calculateIVSkew(chain), 2),
    vegaExposure: round(calculateVegaExposure(chain), 2),
    oiImbalance,
    uvr: round(calculateUVR(totalVolume, avgVolume), 4),
    pcr: calculatePCR(chain),
    maxPainDistance: calculateMaxPainDistance(chain),
    ltpVsVwapPct: estimateLtpVsVwapPct(chain, context),
    vpin: round(clamp(toFiniteNumber(context?.vpin, 28), 0, 100), 2),
    thetaPressure: calculateThetaPressure(chain),
    netDelta: round(dex / 100, 4),
    ivRank: estimateIvRank(chain, context),
    totalVolume,
    avgVolume,
  };
}

export function buildSignalScores(
  metrics: SignalMetrics,
  technical?: TechnicalAnalysisSnapshot | null
): SignalScore[] {
  const anchor = directionalAnchor(metrics);
  const anchorSign = anchor === 0 ? 1 : Math.sign(anchor);
  const unusualVolumeSupport = anchorSign * clamp((metrics.uvr - 1) * 35, -100, 100);
  const ivRankSupport = anchorSign * clamp(30 - metrics.ivRank, -70, 70);
  const toxicitySupport = anchorSign * clamp(60 - metrics.vpin, -80, 80);

  const scores = [
    normalizeSignal({ name: 'gex', value: metrics.gex }),
    normalizeSignal({ name: 'gammaFlip', value: metrics.gammaFlip }),
    normalizeSignal({ name: 'dex', value: metrics.dex }),
    normalizeSignal({ name: 'ivSkew', value: metrics.ivSkew }),
    normalizeSignal({ name: 'vegaExposure', value: metrics.vegaExposure }),
    normalizeSignal({ name: 'oiImbalance', value: metrics.oiImbalance }),
    normalizeSignal({ name: 'pcr', value: metrics.pcr }),
    normalizeSignal({ name: 'maxPainDistance', value: metrics.maxPainDistance }),
    normalizeSignal({ name: 'ltpVsVwapPct', value: metrics.ltpVsVwapPct }),
    normalizeSignal({ name: 'thetaPressure', value: metrics.thetaPressure }),
    normalizeSignal({ name: 'netDelta', value: metrics.netDelta }),
    normalizeSignal({
      name: 'uvr',
      value: unusualVolumeSupport,
      description: 'Unusual flow aligned to the prevailing directional anchor.',
    }),
    normalizeSignal({
      name: 'ivRank',
      value: ivRankSupport,
      description: 'IV rank translated into directional opportunity support.',
    }),
    normalizeSignal({
      name: 'vpin',
      value: toxicitySupport,
      description: 'Toxicity-adjusted directional conviction.',
    }),
  ];

  if (technical) {
    const technicalValue =
      technical.signal === 'BUY' ? 70 : technical.signal === 'SELL' ? -70 : 0;
    scores.push(
      normalizeSignal({
        name: 'technicalSignal',
        value: technicalValue,
        description: 'Spot-derived SuperTrend and RSI confirmation.',
      })
    );
  }

  return scores;
}

export function buildAnalyticsSnapshot(input: BuildAnalyticsInput): AnalyticsSnapshot {
  const chain = createOptionChain(input);
  const strategy = input.context?.strategy ?? 'momentum';
  const technical = input.technical ?? input.context?.technical ?? null;
  const metrics = deriveSignalMetrics(chain, input.context);
  const signalScores = buildSignalScores(metrics, technical);
  const confluence = computeConfluence({
    signals: signalScores,
    strategy,
    timestamp: input.timestamp,
  });

  return {
    symbol: input.symbol,
    strategy,
    chain,
    metrics,
    signalScores,
    confluence,
    generatedAt: input.timestamp ?? new Date().toISOString(),
    technical,
  };
}

export function updateVolumeHistory(
  previousHistory: number[],
  totalVolume: number,
  maxPoints = 20
) {
  const next = [...previousHistory, totalVolume].filter(
    (value) => Number.isFinite(value) && value >= 0
  );

  if (next.length <= maxPoints) {
    return next;
  }

  return next.slice(next.length - maxPoints);
}
