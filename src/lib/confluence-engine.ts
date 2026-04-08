import type {
  ConfluenceBreakdownItem,
  ConfluenceRegime,
  ConfluenceResult,
  MarketBias,
  SignalMetricKey,
  SignalScore,
  StrategyProfile,
} from '@/lib/types';

type SignalDefinition = {
  higherIsBullish: boolean;
  scale: number;
  midpoint?: number;
  description: string;
  weight: number;
};

type ComputeConfluenceInput = {
  signals: SignalScore[];
  strategy?: StrategyProfile;
  timestamp?: string;
};

const SIGNAL_DEFINITIONS: Partial<Record<SignalMetricKey, SignalDefinition>> = {
  gex: {
    higherIsBullish: true,
    scale: 40,
    description: 'Dealer gamma support and pinning structure.',
    weight: 1.15,
  },
  gammaFlip: {
    higherIsBullish: true,
    scale: 2,
    description: 'Spot relative to the gamma-flip regime.',
    weight: 1.1,
  },
  dex: {
    higherIsBullish: true,
    scale: 45,
    description: 'Net delta exposure from the options surface.',
    weight: 1,
  },
  ivSkew: {
    higherIsBullish: true,
    scale: 8,
    description: 'Call-put implied-volatility skew.',
    weight: 0.8,
  },
  vegaExposure: {
    higherIsBullish: true,
    scale: 45,
    description: 'Net vega positioning across the chain.',
    weight: 0.8,
  },
  oiImbalance: {
    higherIsBullish: true,
    scale: 35,
    description: 'Delta-weighted call-versus-put open-interest pressure.',
    weight: 1.2,
  },
  uvr: {
    higherIsBullish: true,
    midpoint: 0,
    scale: 45,
    description: 'Directional follow-through implied by unusual volume.',
    weight: 0.9,
  },
  pcr: {
    higherIsBullish: false,
    midpoint: 1.05,
    scale: 0.4,
    description: 'Put-call ratio regime.',
    weight: 0.95,
  },
  maxPainDistance: {
    higherIsBullish: true,
    scale: 1.2,
    description: 'Signed distance from max-pain gravity.',
    weight: 0.75,
  },
  ltpVsVwapPct: {
    higherIsBullish: true,
    scale: 0.8,
    description: 'Underlying location versus a VWAP-style proxy.',
    weight: 0.85,
  },
  vpin: {
    higherIsBullish: true,
    midpoint: 0,
    scale: 45,
    description: 'Directional conviction after adjusting for flow toxicity.',
    weight: 0.7,
  },
  thetaPressure: {
    higherIsBullish: false,
    midpoint: 25,
    scale: 18,
    description: 'Lower theta pressure is friendlier to long-premium trades.',
    weight: 0.65,
  },
  netDelta: {
    higherIsBullish: true,
    scale: 0.4,
    description: 'Normalized directional delta ownership.',
    weight: 1.05,
  },
  technicalSignal: {
    higherIsBullish: true,
    scale: 60,
    description: 'Spot-based SuperTrend and RSI confirmation.',
    weight: 0.7,
  },
  ivRank: {
    higherIsBullish: true,
    midpoint: 0,
    scale: 45,
    description: 'Directional support implied by current IV rank context.',
    weight: 0.55,
  },
};

const STRATEGY_MULTIPLIERS: Record<StrategyProfile, Partial<Record<SignalMetricKey, number>>> = {
  momentum: {
    uvr: 1.35,
    ltpVsVwapPct: 1.2,
    dex: 1.1,
  },
  meanrev: {
    pcr: 1.2,
    maxPainDistance: 1.35,
    gex: 1.1,
  },
  gamma: {
    gex: 1.35,
    gammaFlip: 1.35,
    dex: 1.05,
  },
  vol_expand: {
    uvr: 1.15,
    ivRank: 1.25,
    ivSkew: 1.1,
  },
  pin_trade: {
    maxPainDistance: 1.5,
    gex: 1.2,
    pcr: 1.05,
  },
  uoa_follow: {
    uvr: 1.45,
    dex: 1.1,
    oiImbalance: 1.15,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function biasFromDirectionalScore(score: number): MarketBias {
  if (score >= 0.1) {
    return 'bullish';
  }
  if (score <= -0.1) {
    return 'bearish';
  }
  return 'neutral';
}

function regimeFromBias(bias: MarketBias): ConfluenceRegime {
  if (bias === 'bullish') {
    return 'LONG';
  }
  if (bias === 'bearish') {
    return 'SHORT';
  }
  return 'NEUTRAL';
}

function resolveDefinition(name: string): SignalDefinition {
  const definition = SIGNAL_DEFINITIONS[name as SignalMetricKey];
  if (definition) {
    return definition;
  }

  return {
    higherIsBullish: true,
    scale: 50,
    description: 'Derived directional signal.',
    weight: 1,
  };
}

export function normalizeSignal(
  signal: Pick<SignalScore, 'name' | 'value'> &
    Partial<Pick<SignalScore, 'weight' | 'description'>>
): SignalScore {
  const definition = resolveDefinition(signal.name);
  const midpoint = definition.midpoint ?? 0;
  const signedDistance = clamp((signal.value - midpoint) / definition.scale, -1, 1);
  const directionalScore = definition.higherIsBullish ? signedDistance : -signedDistance;
  const normalized = round((directionalScore + 1) * 50);
  const confidence = round(Math.abs(directionalScore) * 100);
  const bias = biasFromDirectionalScore(directionalScore);
  const weight = signal.weight ?? definition.weight;
  const contribution = round(((normalized - 50) / 50) * weight * confidence);
  const description = signal.description ?? definition.description;

  return {
    name: signal.name,
    value: round(signal.value, 4),
    normalized,
    weight: round(weight, 3),
    contribution,
    bias,
    confidence,
    description,
  };
}

function normalizeSignals(
  signals: SignalScore[],
  strategy: StrategyProfile
): SignalScore[] {
  const multipliers = STRATEGY_MULTIPLIERS[strategy];

  return signals.map((signal) => {
    const base = normalizeSignal(signal);
    const strategyMultiplier = multipliers[base.name as SignalMetricKey] ?? 1;
    const adjustedWeight = round(base.weight * strategyMultiplier, 3);

    return {
      ...base,
      weight: adjustedWeight,
      contribution: round(((base.normalized - 50) / 50) * adjustedWeight * base.confidence),
    };
  });
}

export function computeConfluence(
  input: ComputeConfluenceInput | SignalScore[]
): ConfluenceResult {
  const strategy = Array.isArray(input) ? 'momentum' : input.strategy ?? 'momentum';
  const timestamp = Array.isArray(input) ? undefined : input.timestamp;
  const sourceSignals = Array.isArray(input) ? input : input.signals;
  const normalizedSignals = normalizeSignals(sourceSignals, strategy);
  const totalWeight = normalizedSignals.reduce((sum, signal) => sum + signal.weight, 0) || 1;

  const bullishScore = round(
    normalizedSignals.reduce(
      (sum, signal) => sum + (signal.normalized / 100) * signal.weight,
      0
    ) /
      totalWeight *
      100
  );
  const bearishScore = round(
    normalizedSignals.reduce(
      (sum, signal) => sum + ((100 - signal.normalized) / 100) * signal.weight,
      0
    ) /
      totalWeight *
      100
  );

  const netScore = round(bullishScore - bearishScore);
  const averageStrength = round(
    normalizedSignals.reduce((sum, signal) => sum + signal.confidence * signal.weight, 0) /
      totalWeight
  );
  const confidence = round(clamp(Math.abs(netScore) * 0.7 + averageStrength * 0.3, 0, 100));
  const thresholdUsed = 8;
  const regime: ConfluenceRegime =
    netScore >= thresholdUsed ? 'LONG' : netScore <= -thresholdUsed ? 'SHORT' : 'NEUTRAL';

  const breakdownItems: ConfluenceBreakdownItem[] = normalizedSignals.map((signal) => ({
    name: signal.name,
    bias: regimeFromBias(signal.bias),
    value: signal.value,
    normalized: signal.normalized,
    contribution: signal.contribution,
    weight: signal.weight,
    description: signal.description,
  }));

  const rationale =
    regime === 'LONG'
      ? 'Bullish confluence dominates across structural, dealer-positioning, and live-flow signals.'
      : regime === 'SHORT'
        ? 'Bearish confluence dominates across structural, dealer-positioning, and live-flow signals.'
        : 'Directional evidence is mixed, so the engine remains neutral until conviction improves.';

  return {
    bullishScore,
    bearishScore,
    netScore,
    confidence,
    regime,
    signals: normalizedSignals,
    breakdown: {
      totalSignals: normalizedSignals.length,
      totalWeight: round(totalWeight, 3),
      directionalSpread: netScore,
      averageStrength,
      items: breakdownItems,
    },
    thresholdUsed,
    rationale,
    timestamp,
  };
}
