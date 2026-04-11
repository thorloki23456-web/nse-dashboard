import type { OptionChain } from '@/lib/types';

export type BucketLabel = 'ATM' | 'CALL_25D' | 'PUT_25D';

export interface BucketLeg {
  strike: number;
  iv: number;
  oi: number;
  volume: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface BucketSpread {
  ivSpread: number;
  oiRatio: number;
  volumeRatio: number;
  thetaDropOff: number;
  gammaRamp: number;
}

export interface BucketRow {
  bucket: BucketLabel;
  currentWeek: BucketLeg;
  nextWeek: BucketLeg;
  spread: BucketSpread;
}

export interface ExpiryComparisonSnapshot {
  symbol: string;
  asOf: string;
  underlyingValue: number;
  daysToCurrentExpiry: number;
  daysToNextExpiry: number;
  expiries: {
    currentWeek: OptionChain;
    nextWeek: OptionChain;
  };
  buckets: BucketRow[];
}

export interface TermStructureFeatures {
  atmTermSpread: number;
  putSkewTransfer: number;
  oiRollRatio: number;
  wallShift: number;
  pinVsBreakout: number;
}

export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'EXPIRY_PIN';

export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export interface FeatureSignal {
  feature: keyof TermStructureFeatures;
  rawValue: number;
  direction: SignalDirection;
  strength: SignalStrength;
  reason: string;
}

export interface TermStructureConfluence {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  pinCount: number;
  dominantDirection: SignalDirection;
  confluenceScore: number;
}

export type TradeableAction =
  | 'BUY_THIS_WEEK_ATM'
  | 'SELL_THIS_WEEK_PREMIUM'
  | 'BUY_NEXT_WEEK_ATM'
  | 'BUY_NEXT_WEEK_OTM_CALL'
  | 'BUY_NEXT_WEEK_OTM_PUT'
  | 'AVOID_THIS_WEEK_LONG'
  | 'WAIT_FOR_EXPIRY_RESOLUTION'
  | 'NO_TRADE';

export interface TradeRecommendation {
  action: TradeableAction;
  direction: SignalDirection;
  strength: SignalStrength;
  rationale: string[];
  riskNote: string;
  suggestedExpiry: 'CURRENT_WEEK' | 'NEXT_WEEK' | 'NONE';
  suggestedStrike?: number;
  confluenceScore: number;
}

export interface TermStructureSignalResult {
  symbol: string;
  asOf: string;
  underlyingValue: number;
  daysToExpiry: number;
  features: TermStructureFeatures;
  featureSignals: FeatureSignal[];
  confluence: TermStructureConfluence;
  recommendation: TradeRecommendation;
}

export interface TermStructureRouteResponse {
  symbol: string;
  currentExpiryDate: string | null;
  nextExpiryDate: string | null;
  snapshot: ExpiryComparisonSnapshot | null;
  result: TermStructureSignalResult | null;
  error: string | null;
}
