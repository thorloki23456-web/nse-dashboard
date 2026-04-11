import { blackScholesGreeks } from '@/lib/greeks';
import type {
  AnalyticsSnapshot,
  MarketBias,
  OptionLeg,
  OptionSide,
  OptionStrike,
  TechnicalAnalysisSnapshot,
} from '@/lib/types';

export type NiftyLongOnlyAction = 'BUY_CE' | 'BUY_PE' | 'NO_TRADE';

export interface NiftyDecisionContribution {
  label: string;
  score: number;
  explanation: string;
}

export interface SuggestedContract {
  strike: number;
  optionType: OptionSide;
  premium: number;
  openInterest: number;
  volume: number;
  delta: number;
  liquidityScore: number;
}

export interface NiftyLongOnlyDecision {
  action: NiftyLongOnlyAction;
  optionType: OptionSide | 'NEUTRAL';
  marketBias: MarketBias;
  confidence: number;
  convictionScore: number;
  selectedContract: SuggestedContract | null;
  entryWindow: {
    underlyingMin: number;
    underlyingMax: number;
    premiumMin: number;
    premiumMax: number;
  } | null;
  risk: {
    stopUnderlying: number | null;
    targetUnderlying: number | null;
    stopPremium: number | null;
    targetPremium: number | null;
  };
  reasons: string[];
  blockers: string[];
  contributions: NiftyDecisionContribution[];
  generatedAt: string;
}

const NIFTY_SYMBOLS = new Set(['NIFTY', 'NIFTY 50']);
const DEFAULT_IV = 0.18;
const DEFAULT_TIME_TO_EXPIRY_YEARS = 7 / 365;
const RISK_FREE_RATE = 0.1;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseExpiryDate(expiryDate?: string | null) {
  if (!expiryDate) {
    return null;
  }

  const match = expiryDate.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText] = match;
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthText);
  if (monthIndex < 0) {
    return null;
  }

  return new Date(Date.UTC(Number(yearText), monthIndex, Number(dayText), 9, 15));
}

function resolveTimeToExpiryYears(snapshot: AnalyticsSnapshot) {
  const expiryDate = parseExpiryDate(snapshot.chain.expiryDate);
  if (!expiryDate) {
    return DEFAULT_TIME_TO_EXPIRY_YEARS;
  }

  const asOf = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();
  const diffMs = expiryDate.getTime() - asOf.getTime();
  const diffDays = clamp(diffMs / (1000 * 60 * 60 * 24), 0.25, 30);
  return diffDays / 365;
}

function getStepSize(strikes: OptionStrike[]) {
  const unique = [...new Set(strikes.map((strike) => strike.strikePrice))].sort((a, b) => a - b);
  if (unique.length < 2) {
    return 50;
  }

  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < unique.length; index += 1) {
    step = Math.min(step, Math.abs(unique[index] - unique[index - 1]));
  }

  return Number.isFinite(step) && step > 0 ? step : 50;
}

function estimateAbsoluteDelta(
  leg: OptionLeg,
  snapshot: AnalyticsSnapshot,
  strikePrice: number,
  optionType: OptionSide,
  timeToExpiryYears: number
) {
  if (typeof leg.delta === 'number' && Number.isFinite(leg.delta)) {
    return Math.abs(leg.delta);
  }

  const sigma = Math.max(DEFAULT_IV, leg.impliedVolatility / 100 || DEFAULT_IV);
  return Math.abs(
    blackScholesGreeks(
      snapshot.chain.underlyingValue,
      strikePrice,
      timeToExpiryYears,
      RISK_FREE_RATE,
      sigma,
      optionType === 'CE'
    ).delta
  );
}

function scoreCandidate(
  strike: OptionStrike,
  leg: OptionLeg,
  snapshot: AnalyticsSnapshot,
  optionType: OptionSide,
  targetDelta: number,
  stepSize: number,
  timeToExpiryYears: number
) {
  const delta = estimateAbsoluteDelta(leg, snapshot, strike.strikePrice, optionType, timeToExpiryYears);
  const deltaFit = 1 - clamp(Math.abs(delta - targetDelta) / 0.4, 0, 1);
  const distanceFit = 1 - clamp(Math.abs(strike.strikePrice - snapshot.chain.underlyingValue) / (stepSize * 4), 0, 1);
  const liquidityScore = clamp(Math.log10(Math.max(1, leg.openInterest)) + Math.log10(Math.max(1, leg.totalTradedVolume)), 0, 10);
  const premiumFit =
    leg.lastPrice < 20 ? clamp(leg.lastPrice / 20, 0, 1) :
    leg.lastPrice > 350 ? clamp(1 - (leg.lastPrice - 350) / 350, 0, 1) :
    1;

  return {
    score: round((deltaFit * 55) + (distanceFit * 15) + (premiumFit * 10) + (liquidityScore * 2), 3),
    delta: round(delta, 3),
    liquidityScore: round(liquidityScore, 3),
  };
}

function selectContract(
  snapshot: AnalyticsSnapshot,
  optionType: OptionSide,
  confidence: number
): SuggestedContract | null {
  const stepSize = getStepSize(snapshot.chain.data);
  const timeToExpiryYears = resolveTimeToExpiryYears(snapshot);
  const targetDelta = confidence >= 78 ? 0.55 : confidence >= 65 ? 0.45 : 0.35;

  const candidates = snapshot.chain.data
    .map((strike) => {
      const leg = strike[optionType];
      if (!leg || leg.lastPrice <= 0 || leg.openInterest <= 0 || leg.totalTradedVolume <= 0) {
        return null;
      }

      const scored = scoreCandidate(
        strike,
        leg,
        snapshot,
        optionType,
        targetDelta,
        stepSize,
        timeToExpiryYears
      );

      return {
        strike: strike.strikePrice,
        optionType,
        premium: round(leg.lastPrice),
        openInterest: leg.openInterest,
        volume: leg.totalTradedVolume,
        delta: scored.delta,
        liquidityScore: scored.liquidityScore,
        candidateScore: scored.score,
      };
    })
    .filter((candidate): candidate is SuggestedContract & { candidateScore: number } => Boolean(candidate))
    .sort((left, right) => right.candidateScore - left.candidateScore);

  if (candidates.length === 0) {
    return null;
  }

  const { candidateScore: _ignored, ...selected } = candidates[0];
  return selected;
}

function biasFromScore(score: number): MarketBias {
  if (score >= 1) {
    return 'bullish';
  }
  if (score <= -1) {
    return 'bearish';
  }
  return 'neutral';
}

function addContribution(
  contributions: NiftyDecisionContribution[],
  label: string,
  score: number,
  explanation: string
) {
  if (Math.abs(score) < 0.01) {
    return 0;
  }

  const rounded = round(score, 2);
  contributions.push({ label, score: rounded, explanation });
  return rounded;
}

function scoreTechnical(technical: TechnicalAnalysisSnapshot | null, contributions: NiftyDecisionContribution[]) {
  if (!technical) {
    return 0;
  }

  let score = 0;
  score += addContribution(
    contributions,
    'spot_signal',
    technical.signal === 'BUY' ? 20 : technical.signal === 'SELL' ? -20 : 0,
    `Spot signal is ${technical.signal}.`
  );
  score += addContribution(
    contributions,
    'trend',
    technical.currentTrend === 'up' ? 12 : technical.currentTrend === 'down' ? -12 : 0,
    `SuperTrend is ${technical.currentTrend}.`
  );

  const rsi = technical.currentRSI;
  const rsiScore =
    technical.currentTrend === 'up' && rsi >= 52 && rsi <= 68 ? 8 :
    technical.currentTrend === 'down' && rsi >= 32 && rsi <= 48 ? -8 :
    rsi > 72 ? -4 :
    rsi < 28 ? 4 :
    0;

  score += addContribution(
    contributions,
    'rsi',
    rsiScore,
    `RSI is ${round(rsi, 1)}.`
  );

  return score;
}

function computeDirectionalScore(snapshot: AnalyticsSnapshot) {
  const { confluence, metrics, termStructure } = snapshot;
  const contributions: NiftyDecisionContribution[] = [];
  let score = 0;

  score += addContribution(
    contributions,
    'confluence_net',
    clamp(confluence.netScore * 0.9, -26, 26),
    `Confluence net score is ${round(confluence.netScore)} with ${round(confluence.confidence, 1)}% confidence.`
  );
  score += addContribution(
    contributions,
    'confluence_confidence',
    confluence.regime === 'LONG'
      ? clamp((confluence.confidence - 50) * 0.35, 0, 10)
      : confluence.regime === 'SHORT'
        ? -clamp((confluence.confidence - 50) * 0.35, 0, 10)
        : 0,
    `Confluence regime is ${confluence.regime}.`
  );
  score += scoreTechnical(snapshot.technical ?? null, contributions);
  score += addContribution(
    contributions,
    'oi_imbalance',
    clamp(metrics.oiImbalance * 0.45, -14, 14),
    `Delta-weighted OI imbalance is ${round(metrics.oiImbalance)}.`
  );
  score += addContribution(
    contributions,
    'gamma_flip',
    clamp(metrics.gammaFlip * 5, -10, 10),
    `Gamma-flip distance is ${round(metrics.gammaFlip, 2)}.`
  );
  score += addContribution(
    contributions,
    'price_vs_vwap',
    clamp(metrics.ltpVsVwapPct * 10, -12, 12),
    `Spot sits ${round(metrics.ltpVsVwapPct, 2)}% versus synthetic VWAP.`
  );
  score += addContribution(
    contributions,
    'pcr_regime',
    clamp((1.05 - metrics.pcr) * 20, -10, 10),
    `PCR regime is ${round(metrics.pcr, 2)}.`
  );

  const anchorBias = score === 0 ? 0 : Math.sign(score);
  score += addContribution(
    contributions,
    'flow_follow_through',
    anchorBias * clamp((metrics.uvr - 1) * 8, 0, 8),
    `Unusual volume ratio is ${round(metrics.uvr, 2)}.`
  );

  if (termStructure?.recommendation) {
    const termDirection = termStructure.recommendation.direction;
    score += addContribution(
      contributions,
      'term_structure',
      termDirection === 'BULLISH' ? 6 : termDirection === 'BEARISH' ? -6 : 0,
      `Weekly term structure leans ${termDirection}.`
    );
  }

  return { score: round(score, 2), contributions };
}

function buildBlockers(snapshot: AnalyticsSnapshot, score: number, optionType: OptionSide | 'NEUTRAL') {
  const blockers: string[] = [];
  const technical = snapshot.technical;
  const { metrics, confluence } = snapshot;

  // hard gates keep the selector from forcing trades when the edge is weak or contradictory.
  if (!technical) {
    blockers.push('Intraday technical confirmation is unavailable.');
  }

  if (snapshot.chain.data.length < 3) {
    blockers.push('Option chain depth is too shallow for strike selection.');
  }

  if (confluence.confidence < 55) {
    blockers.push('Confluence confidence is below the minimum trade threshold.');
  }

  if (Math.abs(score) < 20) {
    blockers.push('Directional edge stayed below the minimum conviction threshold.');
  }

  if (metrics.uvr < 1.15) {
    blockers.push('Flow follow-through is too weak for an intraday long option entry.');
  }

  if (metrics.vpin > 70 && Math.abs(score) < 35) {
    blockers.push('Flow toxicity is elevated and conviction is not strong enough.');
  }

  if (metrics.ivRank > 80 && metrics.thetaPressure > 45 && Math.abs(score) < 35) {
    blockers.push('Premium is too rich for a clean long-premium intraday trade.');
  }

  if (technical && optionType === 'CE' && (technical.signal === 'SELL' || technical.currentTrend === 'down')) {
    blockers.push('Spot trend does not confirm a bullish long.');
  }

  if (technical && optionType === 'PE' && (technical.signal === 'BUY' || technical.currentTrend === 'up')) {
    blockers.push('Spot trend does not confirm a bearish long.');
  }

  return blockers;
}

function buildRiskProfile(
  snapshot: AnalyticsSnapshot,
  contract: SuggestedContract | null,
  optionType: OptionSide | 'NEUTRAL'
) {
  if (!contract || !snapshot.technical || optionType === 'NEUTRAL') {
    return {
      stopUnderlying: null,
      targetUnderlying: null,
      stopPremium: null,
      targetPremium: null,
    };
  }

  const anchorPrice = snapshot.technical.currentPrice ?? snapshot.chain.underlyingValue;
  const atr = Math.max(snapshot.technical.currentATR, anchorPrice * 0.0025);
  const stopDistance = atr * 0.8;
  const targetDistance = atr * 1.6;
  const stopUnderlying = optionType === 'CE' ? anchorPrice - stopDistance : anchorPrice + stopDistance;
  const targetUnderlying = optionType === 'CE' ? anchorPrice + targetDistance : anchorPrice - targetDistance;

  return {
    stopUnderlying: round(stopUnderlying),
    targetUnderlying: round(targetUnderlying),
    stopPremium: round(contract.premium * 0.75),
    targetPremium: round(contract.premium * 1.4),
  };
}

function buildEntryWindow(
  snapshot: AnalyticsSnapshot,
  contract: SuggestedContract | null,
  optionType: OptionSide | 'NEUTRAL'
) {
  if (!contract || !snapshot.technical || optionType === 'NEUTRAL') {
    return null;
  }

  const anchorPrice = snapshot.technical.currentPrice ?? snapshot.chain.underlyingValue;
  const atr = Math.max(snapshot.technical.currentATR, anchorPrice * 0.0025);
  const minUnderlying = optionType === 'CE' ? anchorPrice - atr * 0.1 : anchorPrice - atr * 0.25;
  const maxUnderlying = optionType === 'CE' ? anchorPrice + atr * 0.25 : anchorPrice + atr * 0.1;

  return {
    underlyingMin: round(minUnderlying),
    underlyingMax: round(maxUnderlying),
    premiumMin: round(contract.premium * 0.97),
    premiumMax: round(contract.premium * 1.03),
  };
}

export function selectNiftyLongOnlyTrade(snapshot: AnalyticsSnapshot | null): NiftyLongOnlyDecision | null {
  if (!snapshot || !NIFTY_SYMBOLS.has(snapshot.symbol.toUpperCase())) {
    return null;
  }

  const { score, contributions } = computeDirectionalScore(snapshot);
  const marketBias = biasFromScore(score);
  const optionType = score >= 20 ? 'CE' : score <= -20 ? 'PE' : 'NEUTRAL';
  const rawConfidence = clamp(52 + Math.abs(score) * 0.8, 0, 95);
  const selectedContract = optionType === 'NEUTRAL' ? null : selectContract(snapshot, optionType, rawConfidence);
  const blockers = buildBlockers(snapshot, score, optionType);

  if ((optionType === 'CE' || optionType === 'PE') && !selectedContract) {
    blockers.push('No liquid contract near the target delta was available.');
  }

  const finalAction =
    blockers.length > 0 || optionType === 'NEUTRAL'
      ? 'NO_TRADE'
      : optionType === 'CE'
        ? 'BUY_CE'
        : 'BUY_PE';

  const reasons = contributions
    .filter((item) => (finalAction === 'BUY_CE' ? item.score > 0 : finalAction === 'BUY_PE' ? item.score < 0 : Math.abs(item.score) >= 6))
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
    .slice(0, 4)
    .map((item) => `${item.label}: ${item.explanation}`);

  const confidence = round(
    finalAction === 'NO_TRADE'
      ? clamp(Math.abs(score) - (blockers.length * 4), 0, 55)
      : clamp(rawConfidence - (blockers.length * 6), 0, 95),
    1
  );

  return {
    action: finalAction,
    optionType: finalAction === 'NO_TRADE' ? 'NEUTRAL' : optionType,
    marketBias,
    confidence,
    convictionScore: round(score, 1),
    selectedContract: finalAction === 'NO_TRADE' ? null : selectedContract,
    entryWindow: finalAction === 'NO_TRADE' ? null : buildEntryWindow(snapshot, selectedContract, optionType),
    risk: finalAction === 'NO_TRADE'
      ? { stopUnderlying: null, targetUnderlying: null, stopPremium: null, targetPremium: null }
      : buildRiskProfile(snapshot, selectedContract, optionType),
    reasons,
    blockers,
    contributions: contributions.sort((left, right) => Math.abs(right.score) - Math.abs(left.score)),
    generatedAt: snapshot.generatedAt,
  };
}
