export type OptionSide = 'CE' | 'PE';

export type MarketBias = 'bullish' | 'bearish' | 'neutral';

export type ConfluenceRegime = 'LONG' | 'SHORT' | 'NEUTRAL';

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
  data: OptionStrike[];
}

// Existing contract used by page.tsx + OptionChainDiffTable and tests.
export interface OptionChainDiff {
  strike: number;
  ce_oi_diff: number;
  pe_oi_diff: number;
  ce_vol_diff: number;
  pe_vol_diff: number;
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
  | 'netDelta';

export type SignalMetricMap = Partial<Record<SignalMetricKey, number>>;

export interface SignalMetrics {
  gex: number;
  gammaFlip: number;
  dex: number;
  ivSkew: number;
  vegaExposure: number;
  oiImbalance: number;
  uvr: number;
  pcr?: number;
  maxPainDistance?: number;
  ltpVsVwapPct?: number;
  vpin?: number;
  thetaPressure?: number;
  netDelta?: number;
}

export interface SignalScore {
  name: SignalMetricKey | string;
  value: number;
  normalized: number;
  weight: number;
  contribution: number;
  bias: MarketBias;
  confidence?: number;
  description: string;
}

export interface ConfluenceResult {
  bullishScore: number;
  bearishScore: number;
  netScore: number;
  confidence: number;
  regime: ConfluenceRegime;
  signals: SignalScore[];
  thresholdUsed?: number;
  timestamp?: string;
  rationale?: string;
}

export interface ConfluenceInput {
  symbol: string;
  strategy?: string;
  metrics: SignalMetrics;
  weights?: SignalMetricMap;
  timestamp?: string;
}

export interface AnalyticsSnapshot {
  symbol: string;
  strategy?: string;
  chain: OptionChain;
  metrics: SignalMetrics;
  confluence: ConfluenceResult;
  generatedAt: string;
}
