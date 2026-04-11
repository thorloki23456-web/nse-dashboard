import { blackScholesGreeks } from '@/lib/greeks';
import type { Greeks } from '@/lib/greeks';
import type { OptionChain, OptionLeg, OptionStrike } from '@/lib/types';
import type {
  BucketLeg,
  BucketRow,
  ExpiryComparisonSnapshot,
  FeatureSignal,
  SignalDirection,
  SignalStrength,
  TermStructureConfluence,
  TermStructureFeatures,
  TermStructureSignalResult,
  TradeRecommendation,
  TradeableAction,
} from '@/lib/termStructure.types';

const DEFAULT_RISK_FREE_RATE = 0.1;
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

type BucketType = 'ATM' | 'CALL_25D' | 'PUT_25D';

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeIv(iv: number) {
  return iv > 1 ? iv / 100 : iv;
}

function resolveExpiryTimestamp(chain: OptionChain, strike?: OptionStrike) {
  const rawExpiry = strike?.expiryDate ?? chain.expiryDate;

  if (!rawExpiry) {
    return null;
  }

  const timestamp = Date.parse(rawExpiry);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveTimeToExpiryYears(chain: OptionChain, strike?: OptionStrike) {
  const expiryTimestamp = resolveExpiryTimestamp(chain, strike);

  if (!expiryTimestamp) {
    return null;
  }

  const years = (expiryTimestamp - Date.now()) / ONE_DAY_IN_MS / 365;
  return years > 0 ? years : null;
}

function canComputeGreeks(
  spot: number,
  strikePrice: number,
  timeToExpiryYears: number | null,
  impliedVolatility: number
) {
  return (
    Number.isFinite(spot) &&
    spot > 0 &&
    Number.isFinite(strikePrice) &&
    strikePrice > 0 &&
    Number.isFinite(impliedVolatility) &&
    impliedVolatility > 0 &&
    timeToExpiryYears !== null &&
    timeToExpiryYears > 0
  );
}

function computeFallbackGreeks(
  spot: number,
  strikePrice: number,
  timeToExpiryYears: number | null,
  impliedVolatility: number,
  isCall: boolean
): Greeks | null {
  if (!canComputeGreeks(spot, strikePrice, timeToExpiryYears, impliedVolatility)) {
    return null;
  }

  if (timeToExpiryYears === null) {
    return null;
  }

  return blackScholesGreeks(
    spot,
    strikePrice,
    timeToExpiryYears,
    DEFAULT_RISK_FREE_RATE,
    impliedVolatility,
    isCall
  );
}

function resolveGreeks(
  chain: OptionChain,
  strike: OptionStrike,
  side: 'CE' | 'PE',
  spot: number
) {
  const leg = strike[side];
  const strikePrice = toFiniteNumber(strike.strikePrice, 0);
  const timeToExpiryYears = resolveTimeToExpiryYears(chain, strike);
  const impliedVolatility = normalizeIv(toFiniteNumber(leg?.impliedVolatility, 0));
  const fallback = computeFallbackGreeks(
    spot,
    strikePrice,
    timeToExpiryYears,
    impliedVolatility,
    side === 'CE'
  );

  return {
    delta:
      typeof leg?.delta === 'number' && Number.isFinite(leg.delta) ? leg.delta : fallback?.delta,
    gamma:
      typeof leg?.gamma === 'number' && Number.isFinite(leg.gamma) ? leg.gamma : fallback?.gamma,
    theta:
      typeof leg?.theta === 'number' && Number.isFinite(leg.theta) ? leg.theta : fallback?.theta,
    vega:
      typeof leg?.vega === 'number' && Number.isFinite(leg.vega) ? leg.vega : fallback?.vega,
  };
}

function toBucketLeg(strike: OptionStrike, leg: OptionLeg | undefined, greeks?: Partial<Greeks>): BucketLeg {
  return {
    strike: toFiniteNumber(strike.strikePrice, 0),
    iv: toFiniteNumber(leg?.impliedVolatility, 0),
    oi: toFiniteNumber(leg?.openInterest, 0),
    volume: toFiniteNumber(leg?.totalTradedVolume, 0),
    delta: greeks?.delta,
    gamma: greeks?.gamma,
    theta: greeks?.theta,
    vega: greeks?.vega,
  };
}

function findATMStrike(strikes: OptionStrike[], spot: number) {
  if (strikes.length === 0) {
    return null;
  }

  return strikes.reduce((previous, current) =>
    Math.abs(current.strikePrice - spot) < Math.abs(previous.strikePrice - spot) ? current : previous
  );
}

function findStrikeByDelta(
  chain: OptionChain,
  spot: number,
  side: 'CE' | 'PE',
  targetDelta: number
) {
  let bestMatch: {
    strike: OptionStrike;
    leg: OptionLeg;
    greeks: ReturnType<typeof resolveGreeks>;
    distance: number;
  } | null = null;

  for (const strike of chain.data) {
    const leg = strike[side];

    if (!leg) {
      continue;
    }

    const greeks = resolveGreeks(chain, strike, side, spot);
    const delta = greeks.delta;

    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      continue;
    }

    const distance = Math.abs(delta - targetDelta);

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { strike, leg, greeks, distance };
    }
  }

  return bestMatch;
}

function findOTMCallFallback(strikes: OptionStrike[], spot: number, pctOTM: number) {
  const candidates = strikes.filter((strike) => strike.strikePrice > spot && strike.CE);

  if (candidates.length === 0) {
    return strikes.find((strike) => strike.CE) ?? strikes[0] ?? null;
  }

  const target = spot * (1 + pctOTM);

  return candidates.reduce((previous, current) =>
    Math.abs(current.strikePrice - target) < Math.abs(previous.strikePrice - target) ? current : previous
  );
}

function findOTMPutFallback(strikes: OptionStrike[], spot: number, pctOTM: number) {
  const candidates = strikes.filter((strike) => strike.strikePrice < spot && strike.PE);

  if (candidates.length === 0) {
    return strikes.find((strike) => strike.PE) ?? strikes[0] ?? null;
  }

  const target = spot * (1 - pctOTM);

  return candidates.reduce((previous, current) =>
    Math.abs(current.strikePrice - target) < Math.abs(previous.strikePrice - target) ? current : previous
  );
}

function extractBucketLeg(chain: OptionChain, spot: number, bucketType: BucketType): BucketLeg {
  if (chain.data.length === 0) {
    return {
      strike: 0,
      iv: 0,
      oi: 0,
      volume: 0,
    };
  }

  if (bucketType === 'ATM') {
    const atmStrike = findATMStrike(chain.data, spot);

    if (!atmStrike) {
      return {
        strike: 0,
        iv: 0,
        oi: 0,
        volume: 0,
      };
    }

    const callGreeks = atmStrike.CE ? resolveGreeks(chain, atmStrike, 'CE', spot) : undefined;
    const putGreeks = atmStrike.PE ? resolveGreeks(chain, atmStrike, 'PE', spot) : undefined;
    const representativeGreeks = callGreeks ?? putGreeks;

    return {
      strike: atmStrike.strikePrice,
      iv:
        atmStrike.CE && atmStrike.PE
          ? (toFiniteNumber(atmStrike.CE.impliedVolatility, 0) + toFiniteNumber(atmStrike.PE.impliedVolatility, 0)) /
            2
          : toFiniteNumber(atmStrike.CE?.impliedVolatility ?? atmStrike.PE?.impliedVolatility, 0),
      oi: toFiniteNumber(atmStrike.CE?.openInterest, 0) + toFiniteNumber(atmStrike.PE?.openInterest, 0),
      volume:
        toFiniteNumber(atmStrike.CE?.totalTradedVolume, 0) +
        toFiniteNumber(atmStrike.PE?.totalTradedVolume, 0),
      delta: representativeGreeks?.delta,
      gamma: representativeGreeks?.gamma,
      theta: representativeGreeks?.theta,
      vega: representativeGreeks?.vega,
    };
  }

  if (bucketType === 'CALL_25D') {
    const resolved = findStrikeByDelta(chain, spot, 'CE', 0.25);
    const strike = resolved?.strike ?? findOTMCallFallback(chain.data, spot, 0.01);
    const leg = strike?.CE;
    const greeks = strike && leg ? resolveGreeks(chain, strike, 'CE', spot) : undefined;

    return strike ? toBucketLeg(strike, leg, greeks) : { strike: 0, iv: 0, oi: 0, volume: 0 };
  }

  const resolved = findStrikeByDelta(chain, spot, 'PE', -0.25);
  const strike = resolved?.strike ?? findOTMPutFallback(chain.data, spot, 0.01);
  const leg = strike?.PE;
  const greeks = strike && leg ? resolveGreeks(chain, strike, 'PE', spot) : undefined;

  return strike ? toBucketLeg(strike, leg, greeks) : { strike: 0, iv: 0, oi: 0, volume: 0 };
}

function buildBucketRow(
  label: BucketRow['bucket'],
  currentChain: OptionChain,
  nextChain: OptionChain,
  spot: number,
  bucketType: BucketType
): BucketRow {
  const currentLeg = extractBucketLeg(currentChain, spot, bucketType);
  const nextLeg = extractBucketLeg(nextChain, spot, bucketType);

  return {
    bucket: label,
    currentWeek: currentLeg,
    nextWeek: nextLeg,
    spread: {
      ivSpread: currentLeg.iv - nextLeg.iv,
      oiRatio: safeDiv(nextLeg.oi, currentLeg.oi),
      volumeRatio: safeDiv(nextLeg.volume, currentLeg.volume),
      thetaDropOff: safeDiv(Math.abs(currentLeg.theta ?? 0), Math.abs(nextLeg.theta ?? 0)),
      gammaRamp: safeDiv(currentLeg.gamma ?? 0, nextLeg.gamma ?? 0),
    },
  };
}

function getBucket(snapshot: ExpiryComparisonSnapshot, label: BucketRow['bucket']) {
  return snapshot.buckets.find((bucket) => bucket.bucket === label) ?? null;
}

function findMaxOiStrike(chain: OptionChain) {
  let maxOi = 0;
  let maxStrike = chain.data[0]?.strikePrice ?? 0;

  for (const strike of chain.data) {
    const openInterest =
      toFiniteNumber(strike.CE?.openInterest, 0) + toFiniteNumber(strike.PE?.openInterest, 0);

    if (openInterest > maxOi) {
      maxOi = openInterest;
      maxStrike = strike.strikePrice;
    }
  }

  return maxStrike;
}

function findMaxPainStrike(chain: OptionChain) {
  let minPain = Number.POSITIVE_INFINITY;
  let maxPainStrike = chain.data[0]?.strikePrice ?? 0;

  for (const candidate of chain.data) {
    let totalPain = 0;

    for (const strike of chain.data) {
      const callPain =
        strike.CE && strike.strikePrice < candidate.strikePrice
          ? (candidate.strikePrice - strike.strikePrice) * toFiniteNumber(strike.CE.openInterest, 0)
          : 0;
      const putPain =
        strike.PE && strike.strikePrice > candidate.strikePrice
          ? (strike.strikePrice - candidate.strikePrice) * toFiniteNumber(strike.PE.openInterest, 0)
          : 0;

      totalPain += callPain + putPain;
    }

    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = candidate.strikePrice;
    }
  }

  return maxPainStrike;
}

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / ONE_DAY_IN_MS));
}

function safeDiv(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function computeFeatures(snapshot: ExpiryComparisonSnapshot): TermStructureFeatures {
  const atm = getBucket(snapshot, 'ATM');
  const call25 = getBucket(snapshot, 'CALL_25D');
  const put25 = getBucket(snapshot, 'PUT_25D');

  if (!atm || !call25 || !put25) {
    return {
      atmTermSpread: 0,
      putSkewTransfer: 0,
      oiRollRatio: 0,
      wallShift: 0,
      pinVsBreakout: 0,
    };
  }

  const skewThis = put25.currentWeek.iv - call25.currentWeek.iv;
  const skewNext = put25.nextWeek.iv - call25.nextWeek.iv;
  const currentWallStrike = findMaxOiStrike(snapshot.expiries.currentWeek);
  const nextWallStrike = findMaxOiStrike(snapshot.expiries.nextWeek);
  const currentMaxPain = findMaxPainStrike(snapshot.expiries.currentWeek);

  return {
    atmTermSpread: atm.currentWeek.iv - atm.nextWeek.iv,
    putSkewTransfer: skewNext - skewThis,
    oiRollRatio: safeDiv(atm.nextWeek.oi, atm.currentWeek.oi),
    wallShift: nextWallStrike - currentWallStrike,
    pinVsBreakout: Math.abs(snapshot.underlyingValue - currentMaxPain),
  };
}

function interpretFeatures(features: TermStructureFeatures, snapshot: ExpiryComparisonSnapshot) {
  const signals: FeatureSignal[] = [];
  const spot = snapshot.underlyingValue || 1;
  const daysToExpiry = snapshot.daysToCurrentExpiry;

  {
    const value = features.atmTermSpread;
    let direction: SignalDirection;
    let strength: SignalStrength;
    let reason: string;

    if (value > 5) {
      direction = 'EXPIRY_PIN';
      strength = 'STRONG';
      reason = `Front-week ATM IV is ${value.toFixed(1)}% above next-week, which points to heavy expiry stress and pinning risk.`;
    } else if (value > 2) {
      direction = 'NEUTRAL';
      strength = 'MODERATE';
      reason = `Front-week ATM IV is ${value.toFixed(1)}% above next-week, which looks like normal expiry decay rather than a clean directional edge.`;
    } else if (value >= -1) {
      direction = 'NEUTRAL';
      strength = 'WEAK';
      reason = `ATM IV term spread is tight at ${value.toFixed(1)}%, so the market is not pricing unusual expiry stress.`;
    } else {
      direction = 'BEARISH';
      strength = value < -3 ? 'STRONG' : 'MODERATE';
      reason = `Next-week ATM IV is richer than the front week by ${Math.abs(value).toFixed(1)}%, which suggests forward risk is being priced beyond expiry.`;
    }

    signals.push({ feature: 'atmTermSpread', rawValue: value, direction, strength, reason });
  }

  {
    const value = features.putSkewTransfer;
    let direction: SignalDirection;
    let strength: SignalStrength;
    let reason: string;

    if (value > 2) {
      direction = 'BEARISH';
      strength = 'STRONG';
      reason = `Put skew is migrating into next week by ${value.toFixed(1)}%, which signals durable downside hedging beyond the current expiry.`;
    } else if (value > 0.5) {
      direction = 'BEARISH';
      strength = 'MODERATE';
      reason = `Put skew is moderately transferring into next week by ${value.toFixed(1)}%, which shows hedge demand rolling forward.`;
    } else if (value >= -0.5) {
      direction = 'NEUTRAL';
      strength = 'WEAK';
      reason = `Skew transfer is neutral at ${value.toFixed(1)}%, so there is no clear hedge migration signal between the two expiries.`;
    } else if (value < -2) {
      direction = 'BULLISH';
      strength = 'STRONG';
      reason = `Put skew is collapsing in next week versus this week by ${Math.abs(value).toFixed(1)}%, which suggests fear is short-term rather than durable.`;
    } else {
      direction = 'BULLISH';
      strength = 'MODERATE';
      reason = `Put skew is easing in next week by ${Math.abs(value).toFixed(1)}%, which slightly favors a bullish post-expiry read.`;
    }

    signals.push({ feature: 'putSkewTransfer', rawValue: value, direction, strength, reason });
  }

  {
    const value = features.oiRollRatio;
    let direction: SignalDirection;
    let strength: SignalStrength;
    let reason: string;

    if (value > 2) {
      direction = daysToExpiry <= 2 ? 'BULLISH' : 'NEUTRAL';
      strength = 'STRONG';
      reason = `OI roll ratio is ${value.toFixed(2)}x, which shows heavy positioning building in next week as risk rolls forward.`;
    } else if (value > 1.2) {
      direction = 'BULLISH';
      strength = 'MODERATE';
      reason = `OI roll ratio is ${value.toFixed(2)}x, which confirms moderate next-week accumulation and a continuation bias.`;
    } else if (value >= 0.7) {
      direction = 'NEUTRAL';
      strength = 'WEAK';
      reason = `OI roll ratio is balanced at ${value.toFixed(2)}x, so neither expiry is clearly dominating positioning.`;
    } else {
      direction = 'EXPIRY_PIN';
      strength = 'STRONG';
      reason = `OI roll ratio is only ${value.toFixed(2)}x, which means front-week OI still dominates and the move is likely expiry-driven.`;
    }

    signals.push({ feature: 'oiRollRatio', rawValue: value, direction, strength, reason });
  }

  {
    const value = features.wallShift;
    const pctShift = (value / spot) * 100;
    let direction: SignalDirection;
    let strength: SignalStrength;
    let reason: string;

    if (pctShift > 1.5) {
      direction = 'BULLISH';
      strength = 'STRONG';
      reason = `Next-week max OI wall is ${value.toFixed(0)} points above this week, giving a clear upside target after expiry.`;
    } else if (pctShift > 0.5) {
      direction = 'BULLISH';
      strength = 'MODERATE';
      reason = `Next-week wall is ${value.toFixed(0)} points above this week, which shows a mild upside shift in positioning.`;
    } else if (pctShift >= -0.5) {
      direction = 'NEUTRAL';
      strength = 'WEAK';
      reason = `Wall shift is minimal at ${value.toFixed(0)} points, so both expiries are clustering around the same strike.`;
    } else if (pctShift < -1.5) {
      direction = 'BEARISH';
      strength = 'STRONG';
      reason = `Next-week max OI wall is ${Math.abs(value).toFixed(0)} points below this week, which points to downside positioning beyond expiry.`;
    } else {
      direction = 'BEARISH';
      strength = 'MODERATE';
      reason = `Next-week wall is ${Math.abs(value).toFixed(0)} points below this week, which leans mildly bearish after expiry.`;
    }

    signals.push({ feature: 'wallShift', rawValue: value, direction, strength, reason });
  }

  {
    const value = features.pinVsBreakout;
    const pctDistance = (value / spot) * 100;
    const wallDirectionIsUp = features.wallShift > 0;
    let direction: SignalDirection;
    let strength: SignalStrength;
    let reason: string;

    if (pctDistance < 0.3) {
      direction = 'EXPIRY_PIN';
      strength = 'STRONG';
      reason = `Spot is only ${value.toFixed(0)} points from max pain, so pinning pressure into expiry is strong.`;
    } else if (pctDistance < 0.8) {
      direction = 'EXPIRY_PIN';
      strength = 'MODERATE';
      reason = `Spot is ${value.toFixed(0)} points from max pain, which still suggests moderate pin gravity into expiry.`;
    } else if (pctDistance < 1.5) {
      direction = wallDirectionIsUp ? 'BULLISH' : 'BEARISH';
      strength = 'MODERATE';
      reason = wallDirectionIsUp
        ? `Spot is ${value.toFixed(0)} points from max pain, so breakout distance exists and the higher next-week wall supports upside.`
        : `Spot is ${value.toFixed(0)} points from max pain, so breakout distance exists and the lower next-week wall supports downside.`;
    } else {
      direction = wallDirectionIsUp ? 'BULLISH' : 'BEARISH';
      strength = 'STRONG';
      reason = wallDirectionIsUp
        ? `Spot is ${value.toFixed(0)} points from max pain, which looks like clean breakout territory with next-week resistance shifting higher.`
        : `Spot is ${value.toFixed(0)} points from max pain, which looks like clean breakout territory with next-week resistance shifting lower.`;
    }

    signals.push({ feature: 'pinVsBreakout', rawValue: value, direction, strength, reason });
  }

  return signals;
}

function computeConfluence(signals: FeatureSignal[]): TermStructureConfluence {
  const weights: Record<SignalStrength, number> = {
    STRONG: 3,
    MODERATE: 2,
    WEAK: 1,
  };

  let bullScore = 0;
  let bearScore = 0;
  let neutralScore = 0;
  let pinScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let pinCount = 0;

  for (const signal of signals) {
    const weight = weights[signal.strength];

    switch (signal.direction) {
      case 'BULLISH':
        bullScore += weight;
        bullishCount += 1;
        break;
      case 'BEARISH':
        bearScore += weight;
        bearishCount += 1;
        break;
      case 'EXPIRY_PIN':
        pinScore += weight;
        pinCount += 1;
        break;
      default:
        neutralScore += weight;
        neutralCount += 1;
        break;
    }
  }

  const total = bullScore + bearScore + neutralScore + pinScore || 1;
  const confluenceScore = Math.round(((bullScore - bearScore - pinScore * 0.5) / total) * 100);
  const dominantScore = Math.max(bullScore, bearScore, neutralScore, pinScore);
  let dominantDirection: SignalDirection = 'NEUTRAL';

  if (dominantScore === bullScore && bullScore > 0) {
    dominantDirection = 'BULLISH';
  } else if (dominantScore === bearScore && bearScore > 0) {
    dominantDirection = 'BEARISH';
  } else if (dominantScore === pinScore && pinScore > 0) {
    dominantDirection = 'EXPIRY_PIN';
  }

  return {
    bullishCount,
    bearishCount,
    neutralCount,
    pinCount,
    dominantDirection,
    confluenceScore,
  };
}

function buildRecommendation(
  confluence: TermStructureConfluence,
  features: TermStructureFeatures,
  snapshot: ExpiryComparisonSnapshot
): TradeRecommendation {
  const { confluenceScore, dominantDirection } = confluence;
  const daysToExpiry = snapshot.daysToCurrentExpiry;
  const spot = snapshot.underlyingValue;
  const atm = getBucket(snapshot, 'ATM');
  const put25 = getBucket(snapshot, 'PUT_25D');
  const atmStrike = atm?.currentWeek.strike;

  let action: TradeableAction;
  let strength: SignalStrength;
  let suggestedExpiry: TradeRecommendation['suggestedExpiry'];
  let suggestedStrike: number | undefined;
  const rationale: string[] = [];
  let riskNote: string;

  if (dominantDirection === 'EXPIRY_PIN' || confluence.pinCount >= 2) {
    action = 'SELL_THIS_WEEK_PREMIUM';
    strength = confluence.pinCount >= 3 ? 'STRONG' : 'MODERATE';
    suggestedExpiry = 'CURRENT_WEEK';
    suggestedStrike = atmStrike;
    rationale.push('Multiple signals point to expiry pinning near current levels.');
    rationale.push(`Max pain distance is ${features.pinVsBreakout.toFixed(0)} points, so spot is likely to gravitate toward current-week max pain.`);
    rationale.push('Front-week OI still dominates, which makes post-expiry continuation less reliable.');
    rationale.push('This regime favors short front-week premium rather than chasing long gamma.');
    riskNote = `Exit the pin trade if spot breaks above ${(spot * 1.012).toFixed(0)} or below ${(spot * 0.988).toFixed(0)} before expiry.`;
  } else if (confluenceScore >= 40 && dominantDirection === 'BULLISH') {
    const useNextWeek = daysToExpiry <= 2 || features.oiRollRatio > 1.3;
    action = useNextWeek ? 'BUY_NEXT_WEEK_ATM' : 'BUY_THIS_WEEK_ATM';
    strength = confluenceScore >= 60 ? 'STRONG' : 'MODERATE';
    suggestedExpiry = useNextWeek ? 'NEXT_WEEK' : 'CURRENT_WEEK';
    suggestedStrike = useNextWeek ? atm?.nextWeek.strike : atmStrike;
    rationale.push(`Bullish confluence is ${confluenceScore}/100 across the five term-structure signals.`);
    if (features.wallShift > 0) {
      rationale.push(`The next-week OI wall is ${features.wallShift.toFixed(0)} points above this week, which gives a post-expiry upside target.`);
    }
    if (features.oiRollRatio > 1.2) {
      rationale.push(`OI is rolling forward at ${features.oiRollRatio.toFixed(2)}x, which confirms institutions are building next-week exposure.`);
    }
    if (features.putSkewTransfer < 0) {
      rationale.push('Put skew is not rolling forward, which reduces the odds that downside hedging is driving the tape.');
    }
    if (useNextWeek) {
      rationale.push(`${daysToExpiry} DTE remains in the front week, so next-week contracts reduce theta drag on the directional view.`);
    }
    riskNote = 'Invalidate the bullish read if front-week support fails or the OI roll ratio reverses back toward the current expiry.';
  } else if (confluenceScore <= -40 && dominantDirection === 'BEARISH') {
    action = 'BUY_NEXT_WEEK_OTM_PUT';
    strength = confluenceScore <= -60 ? 'STRONG' : 'MODERATE';
    suggestedExpiry = 'NEXT_WEEK';
    suggestedStrike = put25?.nextWeek.strike;
    rationale.push(`Bearish confluence is ${confluenceScore}/100 across the five term-structure signals.`);
    if (features.putSkewTransfer > 1) {
      rationale.push(`Put skew is transferring to next week by ${features.putSkewTransfer.toFixed(1)}%, which shows downside hedges are rolling forward.`);
    }
    if (features.wallShift < 0) {
      rationale.push(`The next-week OI wall sits ${Math.abs(features.wallShift).toFixed(0)} points below this week, which signals downside positioning after expiry.`);
    }
    if (features.atmTermSpread < -1) {
      rationale.push('Next-week ATM IV is already richer than the front week, which is a classic forward-risk warning.');
    }
    riskNote = 'Invalidate the bearish read if put skew collapses or spot reclaims the dominant front-week resistance zone.';
  } else if (confluenceScore > 15) {
    action = 'BUY_NEXT_WEEK_ATM';
    strength = 'WEAK';
    suggestedExpiry = 'NEXT_WEEK';
    suggestedStrike = atm?.nextWeek.strike;
    rationale.push(`Bullish confluence is only ${confluenceScore}/100, so the edge is too soft for front-week longs.`);
    rationale.push('Using next-week ATM options keeps theta damage lower while the term structure firms up.');
    rationale.push('Add size only if OI roll and wall shift continue to strengthen.');
    riskNote = 'Use smaller size until at least three of the five features line up in the same direction.';
  } else if (confluenceScore < -15) {
    action = 'AVOID_THIS_WEEK_LONG';
    strength = 'WEAK';
    suggestedExpiry = 'NEXT_WEEK';
    suggestedStrike = put25?.nextWeek.strike;
    rationale.push(`Bearish confluence is only ${confluenceScore}/100, so the downside read is not strong enough for aggressive front-week longs.`);
    rationale.push('Avoid this-week long calls because theta and pin gravity can still dominate a weak signal.');
    rationale.push('If downside structure strengthens, next-week OTM puts are the cleaner expression.');
    riskNote = 'Wait for stronger skew transfer or a clearer downside wall shift before sizing up.';
  } else if (daysToExpiry <= 1) {
    action = 'WAIT_FOR_EXPIRY_RESOLUTION';
    strength = 'WEAK';
    suggestedExpiry = 'NEXT_WEEK';
    rationale.push(`Only ${daysToExpiry} day(s) remain to the current expiry, so front-week options are mostly pure gamma and noise.`);
    rationale.push('Let expiry pass and reassess when next week becomes the new front contract.');
    rationale.push('This is a better wait state than a forced trade when confluence is weak.');
    riskNote = 'Avoid buying front-week ATM options into the final expiry session without a separate catalyst.';
  } else {
    action = 'NO_TRADE';
    strength = 'WEAK';
    suggestedExpiry = 'NONE';
    rationale.push(`Confluence is near flat at ${confluenceScore}/100, so the weekly term structure is not aligned.`);
    rationale.push('ATM IV spread, OI roll, and wall shift are not giving the same message.');
    rationale.push('Wait for at least three features to align before acting on the weekly structure.');
    riskNote = 'No trade until the comparative expiry signals become more coherent.';
  }

  return {
    action,
    direction: dominantDirection,
    strength,
    rationale,
    riskNote,
    suggestedExpiry,
    suggestedStrike,
    confluenceScore,
  };
}

export function buildExpiryComparisonSnapshot(
  currentWeekChain: OptionChain,
  nextWeekChain: OptionChain,
  spot: number,
  currentExpiryDate: string,
  nextExpiryDate: string
): ExpiryComparisonSnapshot {
  const now = new Date();

  return {
    symbol: currentWeekChain.symbol,
    asOf: now.toISOString(),
    underlyingValue: spot,
    daysToCurrentExpiry: daysBetween(now, new Date(currentExpiryDate)),
    daysToNextExpiry: daysBetween(now, new Date(nextExpiryDate)),
    expiries: {
      currentWeek: currentWeekChain,
      nextWeek: nextWeekChain,
    },
    buckets: [
      buildBucketRow('ATM', currentWeekChain, nextWeekChain, spot, 'ATM'),
      buildBucketRow('CALL_25D', currentWeekChain, nextWeekChain, spot, 'CALL_25D'),
      buildBucketRow('PUT_25D', currentWeekChain, nextWeekChain, spot, 'PUT_25D'),
    ],
  };
}

export function runTermStructureEngine(snapshot: ExpiryComparisonSnapshot): TermStructureSignalResult {
  const features = computeFeatures(snapshot);
  const featureSignals = interpretFeatures(features, snapshot);
  const confluence = computeConfluence(featureSignals);
  const recommendation = buildRecommendation(confluence, features, snapshot);

  return {
    symbol: snapshot.symbol,
    asOf: snapshot.asOf,
    underlyingValue: snapshot.underlyingValue,
    daysToExpiry: snapshot.daysToCurrentExpiry,
    features,
    featureSignals,
    confluence,
    recommendation,
  };
}
