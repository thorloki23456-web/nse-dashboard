export type OptionSide = 'CE' | 'PE';

export type MarketBias = 'bullish' | 'bearish' | 'neutral';

export type ConfluenceRegime = 'LONG' | 'SHORT' | 'NEUTRAL';

export type TechnicalSignal = 'BUY' | 'SELL' | 'NEUTRAL';

export type StrategyProfile =
  | 'momentum'
  | 'meanrev'
  | 'gamma'
  | 'vol_expand'
  | 'pin_trade'
  | 'uoa_follow';

export interface OptionLeg {
  openInterest: number;
  changeinOpenInterest: number;
  totalTradedVolume: number;
  lastPrice: number;
  impliedVolatility: number;
  change?: number;
  pChange?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
}

export interface OptionStrike {
  strikePrice: number;
  expiryDate?: string;
  CE?: OptionLeg;
  PE?: OptionLeg;
}

export interface OptionChain {
  symbol: string;
  expiryDate?: string;
  timestamp?: string;
  underlyingValue: number;
  lotSize?: number;
  data: OptionStrike[];
}

export interface OptionChainDiff {
  strike: number;
  ce_oi_diff: number;
  pe_oi_diff: number;
  ce_vol_diff: number;
  pe_vol_diff: number;
}

export interface TechnicalCandleSnapshot {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  atr: number;
  superTrend: number;
  trend: 'up' | 'down' | 'none';
  rsi: number;
}

export interface TechnicalAnalysisSnapshot {
  signal: TechnicalSignal;
  signalReason: string;
  currentTrend: 'up' | 'down' | 'none';
  currentRSI: number;
  currentATR: number;
  superTrendValue: number;
  currentPrice?: number;
  candleCount?: number;
  recentData?: TechnicalCandleSnapshot[];
}

export type SignalMetricKey =
  | 'gex'
  | 'gammaFlip'
  | 'dex'
  | 'ivSkew'
  | 'vegaExposure'
  | 'oiImbalance'
  | 'uvr'
  | 'pcr'
  | 'maxPainDistance'
  | 'ltpVsVwapPct'
  | 'vpin'
  | 'thetaPressure'
  | 'netDelta'
  | 'technicalSignal'
  | 'ivRank';

export type SignalMetricMap = Partial<Record<SignalMetricKey, number>>;

export interface SignalMetrics {
  gex: number;
  gammaFlip: number;
  dex: number;
  ivSkew: number;
  vegaExposure: number;
  oiImbalance: number;
  uvr: number;
  pcr: number;
  maxPainDistance: number;
  ltpVsVwapPct: number;
  vpin: number;
  thetaPressure: number;
  netDelta: number;
  ivRank: number;
  totalVolume: number;
  avgVolume: number;
}

export interface SignalScore {
  name: SignalMetricKey | string;
  value: number;
  normalized: number;
  weight: number;
  contribution: number;
  bias: MarketBias;
  confidence: number;
  description: string;
}

export interface ConfluenceBreakdownItem {
  name: string;
  bias: ConfluenceRegime;
  value: number;
  normalized: number;
  contribution: number;
  weight: number;
  description: string;
}

export interface ConfluenceBreakdown {
  totalSignals: number;
  totalWeight: number;
  directionalSpread: number;
  averageStrength: number;
  items: ConfluenceBreakdownItem[];
}

export interface ConfluenceResult {
  bullishScore: number;
  bearishScore: number;
  netScore: number;
  confidence: number;
  regime: ConfluenceRegime;
  signals: SignalScore[];
  breakdown: ConfluenceBreakdown;
  thresholdUsed: number;
  rationale: string;
  timestamp?: string;
}

export interface AnalyticsContext {
  strategy?: StrategyProfile;
  avgVolume?: number;
  volumeHistory?: number[];
  ivRank?: number;
  ivRange?: {
    low: number;
    high: number;
  };
  ltpVsVwapPct?: number;
  vpin?: number;
  lotSize?: number;
  technical?: TechnicalAnalysisSnapshot | null;
}

export interface AnalyticsSnapshot {
  symbol: string;
  strategy: StrategyProfile;
  chain: OptionChain;
  metrics: SignalMetrics;
  signalScores: SignalScore[];
  confluence: ConfluenceResult;
  generatedAt: string;
  technical?: TechnicalAnalysisSnapshot | null;
  termStructure?: import('@/lib/termStructure.types').TermStructureSignalResult | null;
}
