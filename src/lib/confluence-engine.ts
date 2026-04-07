import type { ConfluenceResult, SignalScore } from './types';

type DirectionBias = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface NormalizedSignalContribution {
  key: string;
  label: string;
  value: number;
  weight: number;
  bullish: number;
  bearish: number;
  strength: number;
  bias: DirectionBias;
  explanation: string;
}

export interface ComputeConfluenceOptions {
  regimeBuffer?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = safeNumber(obj[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return null;
}

function scale(value: number, min: number, max: number): number {
  if (max === min) {
    return 0.5;
  }
  return clamp((value - min) / (max - min), 0, 1);
}

function inferHigherIsBullish(signal: Record<string, unknown>): boolean {
  const explicitFlag = pickBoolean(signal, ['higherIsBullish', 'isBullishWhenHigh']);
  if (explicitFlag !== null) {
    return explicitFlag;
  }

  const direction = pickString(signal, ['direction', 'orientation', 'bias']);
  if (direction) {
    const normalized = direction.toLowerCase();
    if (normalized.includes('bear')) {
      return false;
    }
    if (normalized.includes('bull')) {
      return true;
    }
  }

  const bullThreshold = pickNumber(signal, ['bullishThreshold']);
  const bearThreshold = pickNumber(signal, ['bearishThreshold']);
  if (bullThreshold !== null && bearThreshold !== null) {
    return bullThreshold >= bearThreshold;
  }

  return true;
}

function inferUnitBullish(value: number, signal: Record<string, unknown>): number {
  const bullishThreshold = pickNumber(signal, ['bullishThreshold']);
  const bearishThreshold = pickNumber(signal, ['bearishThreshold']);

  if (bullishThreshold !== null && bearishThreshold !== null && bullishThreshold !== bearishThreshold) {
    if (bullishThreshold > bearishThreshold) {
      return scale(value, bearishThreshold, bullishThreshold);
    }

    return 1 - scale(value, bullishThreshold, bearishThreshold);
  }

  const min = pickNumber(signal, ['min', 'minValue', 'floor']);
  const max = pickNumber(signal, ['max', 'maxValue', 'ceiling']);
  if (min !== null && max !== null && min !== max) {
    const unit = scale(value, min, max);
    return inferHigherIsBullish(signal) ? unit : 1 - unit;
  }

  const neutral = pickNumber(signal, ['neutral', 'neutralValue', 'midpoint']);
  if (neutral !== null) {
    const referenceRange = Math.max(
      1,
      Math.abs(neutral),
      Math.abs((max ?? neutral) - neutral),
      Math.abs((min ?? neutral) - neutral)
    );
    const shifted = clamp((value - neutral) / referenceRange, -1, 1);
    const bullish = inferHigherIsBullish(signal)
      ? 0.5 + shifted / 2
      : 0.5 - shifted / 2;
    return clamp(bullish, 0, 1);
  }

  if (value >= -1 && value <= 1) {
    return clamp((value + 1) / 2, 0, 1);
  }

  if (value >= 0 && value <= 100) {
    const unit = value / 100;
    return inferHigherIsBullish(signal) ? unit : 1 - unit;
  }

  const sigmoid = 1 / (1 + Math.exp(-value / 25));
  return inferHigherIsBullish(signal) ? sigmoid : 1 - sigmoid;
}

function biasFromSpread(spread: number): DirectionBias {
  if (spread >= 0.08) {
    return 'LONG';
  }
  if (spread <= -0.08) {
    return 'SHORT';
  }
  return 'NEUTRAL';
}

/**
 * Converts a raw signal into a normalized bullish/bearish contribution.
 */
export function normalizeSignal(signal: SignalScore): NormalizedSignalContribution {
  const source = signal as unknown as Record<string, unknown>;

  const key =
    pickString(source, ['key', 'id', 'name', 'label']) ??
    'signal';
  const label = pickString(source, ['label', 'name', 'key']) ?? key;

  const rawValue = pickNumber(source, ['value', 'score', 'raw', 'metric']) ?? 0;
  const weight = clamp(
    pickNumber(source, ['weight', 'importance', 'multiplier']) ?? 1,
    0,
    10
  );

  const inverted = pickBoolean(source, ['invert', 'isInverted']) ?? false;
  const unitBullish = inferUnitBullish(rawValue, source);
  const bullish = inverted ? 1 - unitBullish : unitBullish;
  const bearish = 1 - bullish;

  const spread = bullish - bearish;
  const strength = Math.abs(spread);
  const bias = biasFromSpread(spread);

  const explanation =
    bias === 'NEUTRAL'
      ? `${label} is balanced (${rawValue.toFixed(2)}), adding limited directional edge.`
      : `${label} favors ${bias === 'LONG' ? 'LONG' : 'SHORT'} (${rawValue.toFixed(
          2
        )}) with strength ${(strength * 100).toFixed(1)}%.`;

  return {
    key,
    label,
    value: rawValue,
    weight,
    bullish,
    bearish,
    strength,
    bias,
    explanation,
  };
}

/**
 * Produces deterministic confluence scores and a UI-ready breakdown.
 */
export function computeConfluence(
  signals: SignalScore[],
  options: ComputeConfluenceOptions = {}
): ConfluenceResult {
  const regimeBuffer = clamp(options.regimeBuffer ?? 6, 0, 40);

  if (!signals.length) {
    return {
      bullishScore: 50,
      bearishScore: 50,
      regime: 'NEUTRAL',
      confidence: 0,
      breakdown: {
        totalSignals: 0,
        validSignals: 0,
        totalWeight: 0,
        directionalSpread: 0,
        averageStrength: 0,
        items: [],
      },
    } as unknown as ConfluenceResult;
  }

  const items: NormalizedSignalContribution[] = signals.map((signal) => normalizeSignal(signal));

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const safeWeight = totalWeight > 0 ? totalWeight : 1;

  const bullishRaw = items.reduce((sum, item) => sum + item.bullish * item.weight, 0) / safeWeight;
  const bearishRaw = items.reduce((sum, item) => sum + item.bearish * item.weight, 0) / safeWeight;
  const averageStrength = items.reduce((sum, item) => sum + item.strength * item.weight, 0) / safeWeight;

  const bullishScore = Math.round(clamp(bullishRaw * 100, 0, 100) * 100) / 100;
  const bearishScore = Math.round(clamp(bearishRaw * 100, 0, 100) * 100) / 100;
  const directionalSpread = bullishScore - bearishScore;

  const regime: DirectionBias =
    directionalSpread >= regimeBuffer
      ? 'LONG'
      : directionalSpread <= -regimeBuffer
        ? 'SHORT'
        : 'NEUTRAL';

  const directionalEdge = clamp(Math.abs(directionalSpread) / 100, 0, 1);
  const participation = clamp(averageStrength, 0, 1);
  const dataQuality = clamp(items.filter((item) => Number.isFinite(item.value)).length / signals.length, 0, 1);

  let confidence =
    (directionalEdge * 0.55 + participation * 0.35 + dataQuality * 0.1) * 100;

  // Keep neutral regimes from looking overly certain.
  if (regime === 'NEUTRAL') {
    confidence = Math.min(confidence, 55);
  }

  confidence = Math.round(clamp(confidence, 0, 100) * 100) / 100;

  return {
    bullishScore,
    bearishScore,
    regime,
    confidence,
    breakdown: {
      totalSignals: signals.length,
      validSignals: items.length,
      totalWeight: Math.round(totalWeight * 1000) / 1000,
      directionalSpread: Math.round(directionalSpread * 100) / 100,
      averageStrength: Math.round(averageStrength * 10000) / 10000,
      items,
    },
  } as unknown as ConfluenceResult;
}

