import type { DerivedSignalMetrics, AnalyticsContext } from './analytics';

export type Strategy =
  | 'momentum'
  | 'meanrev'
  | 'gamma'
  | 'vol_expand'
  | 'pin_trade'
  | 'uoa_follow'
  | '0dte'
  | 'gex_squeeze'
  | 'vol_arb'
  | 'delta_neutral';

export type EntryDecision = 'STRONG_ENTER' | 'ENTER' | 'CAUTION' | 'WAIT' | 'SKIP';
export type ConfluenceLevel = 'low' | 'medium' | 'high';

export interface LayerResult {
  score: number;
  max: number;
}

export interface StopLogic {
  hardStop: number | null;
  trailStop: string;
  exitTrigger: string;
}

export interface EntryResult {
  symbol: string;
  score: number;
  decision: EntryDecision;
  confluence: ConfluenceLevel;
  layerScores: { oi: number; greeks: number; ltp: number };
  stopLogic: StopLogic;
  warnings: string[];
  optionType: 'CE' | 'PE' | 'NEUTRAL';
  suggestedDelta: number;
}

export interface StrategyScanResult {
  strategy: Strategy;
  score: number;
  decision: EntryDecision;
  confidence: number;
}

const STRATEGY_WEIGHTS: Record<Strategy, { oi: number; greek: number; ltp: number }> = {
  momentum:      { oi: 1.0, greek: 1.0, ltp: 1.2 },
  meanrev:       { oi: 1.3, greek: 0.9, ltp: 0.8 },
  gamma:         { oi: 0.9, greek: 1.3, ltp: 0.8 },
  vol_expand:    { oi: 0.8, greek: 0.9, ltp: 1.3 },
  pin_trade:     { oi: 1.4, greek: 1.0, ltp: 0.6 },
  uoa_follow:    { oi: 0.9, greek: 0.8, ltp: 1.4 },
  '0dte':        { oi: 0.8, greek: 1.1, ltp: 1.3 },
  gex_squeeze:   { oi: 1.2, greek: 1.2, ltp: 1.0 },
  vol_arb:       { oi: 0.7, greek: 1.1, ltp: 1.2 },
  delta_neutral: { oi: 1.0, greek: 1.3, ltp: 0.9 },
};

// Strategy-specific stop logic strings
const STRATEGY_STOPS: Record<Strategy, { trail: string; exit: string }> = {
  momentum:      { trail: 'ATR(5) × 1.5 from entry',   exit: 'VWAP breach OR PCR crossover' },
  meanrev:       { trail: '50% of max profit',           exit: 'Max pain touch OR expiry' },
  gamma:         { trail: 'Gamma flip breach',           exit: 'GEX wall break' },
  vol_expand:    { trail: 'IV rank > 80',                exit: '50% profit OR 10 DTE' },
  pin_trade:     { trail: 'Expiry',                      exit: 'Max pain breach > 50pts' },
  uoa_follow:    { trail: 'VWAP breach',                 exit: 'Flow reverses OR UVR < 2x' },
  '0dte':        { trail: '30% profit or stop',          exit: 'Same-day expiry OR 100% loss' },
  gex_squeeze:   { trail: 'Trailing 10%',                exit: 'GEX < 50% OR PCR > 1.0' },
  vol_arb:       { trail: 'IV convergence',              exit: 'Term structure normalises' },
  delta_neutral: { trail: 'Delta drift > 0.10',          exit: 'Gamma flip breach' },
};

// Suggested delta per strategy
const STRATEGY_DELTA: Record<Strategy, number> = {
  momentum: 0.50, meanrev: 0.20, gamma: 0.45, vol_expand: 0.00,
  pin_trade: 0.10, uoa_follow: 0.50, '0dte': 0.30, gex_squeeze: 0.50,
  vol_arb: 0.00, delta_neutral: 0.00,
};

// ── Layer 1: OI Structure ────────────────────────────────────────────────────

function scoreOILayer(
  pcr: number,
  gexPct: number,
  mpDist: number,
  oiDeltaImbalance: number,
  dte: number,
  callOIChange: number,
  putOIChange: number,
): LayerResult {
  let score = 0;

  // PCR — contrarian at extremes (matches Python logic)
  if (pcr < 0.7)       score += 20;
  else if (pcr < 0.9)  score += 18;
  else if (pcr > 1.4)  score += 8;
  else if (pcr > 1.2)  score += 12;
  else                 score += 15;

  // GEX wall
  if (gexPct > 70)      score += 20;
  else if (gexPct > 50) score += 18;
  else if (gexPct > 30) score += 12;
  else                  score += 5;

  // Max pain gravity — DTE-aware
  if (dte <= 3) {
    if (mpDist < 15)      score += 8;
    else if (mpDist < 50) score += 20;
    else                  score += 12;
  } else {
    if (mpDist < 30)      score += 10;
    else if (mpDist < 80) score += 15;
    else                  score += 12;
  }

  // Delta-weighted OI imbalance
  if (Math.abs(oiDeltaImbalance) > 30)      score += 15;
  else if (Math.abs(oiDeltaImbalance) > 15) score += 12;
  else if (Math.abs(oiDeltaImbalance) > 5)  score += 8;
  else                                       score += 5;

  // OI change momentum
  if (callOIChange > putOIChange * 2)      score += 10;
  else if (putOIChange > callOIChange * 2) score += 8;
  else                                     score += 5;

  return { score: Math.min(score, 70), max: 70 };
}

// ── Layer 2: Greeks ──────────────────────────────────────────────────────────

function scoreGreeksLayer(
  netDelta: number,
  gammaFlipPct: number,
  vegaSkew: number,
  thetaPressure: number,
  vannaExposure: number,
  charmExposure: number,
): LayerResult {
  let score = 0;

  // Net delta
  if (netDelta > 0.4)       score += 18;
  else if (netDelta > 0.2)  score += 15;
  else if (netDelta < -0.4) score += 8;
  else if (netDelta < -0.2) score += 10;
  else                      score += 12;

  // Gamma flip
  if (gammaFlipPct > 5)       score += 20;
  else if (gammaFlipPct > 0)  score += 15;
  else if (gammaFlipPct > -5) score += 8;
  else                        score += 5;

  // Vega skew
  if (Math.abs(vegaSkew) < 15)      score += 15;
  else if (Math.abs(vegaSkew) < 30) score += 12;
  else                              score += 8;

  // Theta pressure
  if (thetaPressure < 20)      score += 12;
  else if (thetaPressure < 40) score += 10;
  else if (thetaPressure < 60) score += 7;
  else                         score += 4;

  // Vanna exposure (new)
  if (Math.abs(vannaExposure) < 0.1)  score += 10;
  else if (vannaExposure > 0.2)       score += 12;
  else if (vannaExposure < -0.2)      score += 8;
  else                                score += 8;

  // Charm exposure (new) — negative charm near expiry = delta decay
  if (Math.abs(charmExposure) < 0.05) score += 8;
  else if (charmExposure < -0.1)      score += 5; // accelerating delta decay
  else                                score += 6;

  return { score: Math.min(score, 65), max: 65 };
}

// ── Layer 3: Flow / LTP ──────────────────────────────────────────────────────

function scoreFlowLayer(
  ivRank: number,
  uvr: number,
  ltpVsVwapPct: number,
  vpin: number,
  sweepCount: number,
  premiumNet: number,
): LayerResult {
  let score = 0;

  // IV rank
  if (ivRank < 20)      score += 20;
  else if (ivRank < 35) score += 18;
  else if (ivRank > 80) score += 18;
  else if (ivRank > 65) score += 16;
  else                  score += 10;

  // UVR
  if (uvr > 5.0)       score += 20;
  else if (uvr > 3.0)  score += 18;
  else if (uvr > 2.0)  score += 14;
  else if (uvr > 1.5)  score += 10;
  else                 score += 4;

  // LTP vs VWAP
  if (ltpVsVwapPct > 1.5)       score += 15;
  else if (ltpVsVwapPct > 0.5)  score += 12;
  else if (ltpVsVwapPct > -0.5) score += 8;
  else if (ltpVsVwapPct > -1.5) score += 6;
  else                          score += 4;

  // VPIN — penalty for toxic flow
  if (vpin < 25)      score += 12;
  else if (vpin < 40) score += 10;
  else if (vpin < 55) score += 5;
  else                score -= 10; // toxic flow penalty

  // Sweep count (new)
  if (sweepCount >= 10)     score += 12;
  else if (sweepCount >= 5) score += 10;
  else if (sweepCount >= 2) score += 6;
  else                      score += 3;

  // Premium net flow (new) — in absolute units (e.g. INR crores or USD)
  const absNet = Math.abs(premiumNet);
  if (absNet > 10_000_000)     score += 10;
  else if (absNet > 5_000_000) score += 8;
  else if (absNet > 1_000_000) score += 5;
  else                         score += 3;

  return { score: Math.max(0, Math.min(score, 65)), max: 65 };
}

// ── Stop logic ───────────────────────────────────────────────────────────────

function computeStop(
  strategy: Strategy,
  gammaWallStrike: number | null,
  underlyingPrice: number,
): StopLogic {
  const { trail, exit } = STRATEGY_STOPS[strategy];
  let hardStop: number | null = null;

  if (gammaWallStrike != null) {
    hardStop = gammaWallStrike * 0.995;
  } else {
    const pct = strategy === '0dte' || strategy === 'vol_expand' ? 0.90
              : strategy === 'pin_trade' ? 0.95
              : 0.97;
    hardStop = underlyingPrice * pct;
  }

  return { hardStop, trailStop: trail, exitTrigger: exit };
}

// ── Warnings ─────────────────────────────────────────────────────────────────

function buildWarnings(
  vpin: number,
  dte: number,
  gammaFlipPct: number,
  ivRank: number,
  layerDirections: [boolean, boolean, boolean], // [oi_bull, greeks_bull, flow_bull]
): string[] {
  const w: string[] = [];
  if (vpin >= 55)                    w.push('TOXIC FLOW detected — informed trading active');
  if (dte === 0)                     w.push('CRITICAL: 0 DTE — extreme theta decay');
  else if (dte <= 3)                 w.push(`WARNING: ${dte} DTE — accelerated theta decay`);
  if (Math.abs(gammaFlipPct) < 1)   w.push('Near gamma flip — volatility expansion likely');
  if (ivRank > 80)                   w.push('Extremely high IV — selling premium preferred');
  else if (ivRank < 20)              w.push('Extremely low IV — buying opportunities');
  const aligned = layerDirections.filter(Boolean).length;
  if (aligned < 2)                   w.push('Layer direction mismatch — reduced confidence');
  return w;
}

// ── Direction inference ───────────────────────────────────────────────────────

function inferDirection(
  oiDeltaImbalance: number,
  gammaFlipPct: number,
  ltpVsVwapPct: number,
  premiumNet: number,
): 'CE' | 'PE' | 'NEUTRAL' {
  let bull = 0, bear = 0;
  if (oiDeltaImbalance > 10)  bull++; else if (oiDeltaImbalance < -10) bear++;
  if (gammaFlipPct > 0)       bull++; else if (gammaFlipPct < 0)       bear++;
  if (ltpVsVwapPct > 0.3)    bull++; else if (ltpVsVwapPct < -0.3)    bear++;
  if (premiumNet > 0)         bull++; else if (premiumNet < 0)          bear++;
  if (bull > bear + 1) return 'CE';
  if (bear > bull + 1) return 'PE';
  return 'NEUTRAL';
}

// ── Score → decision ─────────────────────────────────────────────────────────

function toDecision(score: number): EntryDecision {
  if (score >= 85) return 'STRONG_ENTER';
  if (score >= 73) return 'ENTER';
  if (score >= 55) return 'CAUTION';
  if (score >= 45) return 'WAIT';
  return 'SKIP';
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EntryInput {
  symbol: string;
  metrics: DerivedSignalMetrics;
  context?: {
    strategy?: Strategy | AnalyticsContext['strategy'];
    pcr?: number;
    maxPainDistance?: number;
    thetaPressure?: number;
    netDelta?: number;
    gammaWallStrike?: number;
    dte?: number;
    callOIChange?: number;
    putOIChange?: number;
    vannaExposure?: number;
    charmExposure?: number;
    sweepCount?: number;
    premiumNet?: number;
    underlyingPrice?: number;
  };
}

export function computeEntryDecision(input: EntryInput): EntryResult {
  const { symbol, metrics, context } = input;
  const strategy: Strategy = (context?.strategy as Strategy) ?? 'momentum';
  const w = STRATEGY_WEIGHTS[strategy];

  const pcr             = context?.pcr             ?? 1.0;
  const mpDist          = context?.maxPainDistance  ?? 100;
  const thetaPressure   = context?.thetaPressure    ?? 20;
  const netDelta        = context?.netDelta         ?? metrics.dex / 100;
  const gammaWallStrike = context?.gammaWallStrike  ?? null;
  const dte             = context?.dte              ?? 5;
  const callOIChange    = context?.callOIChange     ?? 0;
  const putOIChange     = context?.putOIChange      ?? 0;
  const vannaExposure   = context?.vannaExposure    ?? 0;
  const charmExposure   = context?.charmExposure    ?? 0;
  const sweepCount      = context?.sweepCount       ?? 0;
  const premiumNet      = context?.premiumNet       ?? 0;
  const underlyingPrice = context?.underlyingPrice  ?? 0;

  const l1 = scoreOILayer(pcr, metrics.gex, mpDist, metrics.oiImbalance, dte, callOIChange, putOIChange);
  const l2 = scoreGreeksLayer(netDelta, metrics.gammaFlip, metrics.ivSkew, thetaPressure, vannaExposure, charmExposure);
  const l3 = scoreFlowLayer(metrics.ivRank, metrics.uvr, metrics.ltpVsVwapPct, metrics.vpin, sweepCount, premiumNet);

  const raw = l1.score * w.oi + l2.score * w.greek + l3.score * w.ltp;
  const maxPossible = l1.max * w.oi + l2.max * w.greek + l3.max * w.ltp;
  const score = Math.min(100, Math.round((raw / maxPossible) * 100));

  const confluenceCount = [l1.score > l1.max * 0.6, l2.score > l2.max * 0.6, l3.score > l3.max * 0.6].filter(Boolean).length;
  const confluence: ConfluenceLevel = (['low', 'medium', 'high'] as const)[Math.min(confluenceCount, 2)];

  const optionType = inferDirection(metrics.oiImbalance, metrics.gammaFlip, metrics.ltpVsVwapPct, premiumNet);

  const warnings = buildWarnings(
    metrics.vpin,
    dte,
    metrics.gammaFlip,
    metrics.ivRank,
    [metrics.oiImbalance > 0, netDelta > 0, metrics.ltpVsVwapPct > 0],
  );

  return {
    symbol,
    score,
    decision: toDecision(score),
    confluence,
    layerScores: { oi: l1.score, greeks: l2.score, ltp: l3.score },
    stopLogic: computeStop(strategy, gammaWallStrike, underlyingPrice),
    warnings,
    optionType,
    suggestedDelta: STRATEGY_DELTA[strategy],
  };
}

/** Scan all strategies and return results sorted by score descending */
export function scanAllStrategies(input: Omit<EntryInput, 'context'> & { context?: EntryInput['context'] }): StrategyScanResult[] {
  const strategies: Strategy[] = [
    'momentum', 'meanrev', 'gamma', 'vol_expand', 'pin_trade',
    'uoa_follow', '0dte', 'gex_squeeze', 'vol_arb', 'delta_neutral',
  ];

  return strategies
    .map((strategy) => {
      const result = computeEntryDecision({ ...input, context: { ...input.context, strategy } });
      // Strategy confidence: fraction of layers above 60% threshold
      const confidence = Math.round(
        ([result.layerScores.oi / 70, result.layerScores.greeks / 65, result.layerScores.ltp / 65]
          .filter((r) => r > 0.6).length / 3) * 100
      );
      return { strategy, score: result.score, decision: result.decision, confidence };
    })
    .sort((a, b) => b.score - a.score);
}
