import { randomUUID } from 'crypto';
import type { Candle, Signal, Side } from '../types';
import { computeRSI, computeSuperTrend } from '@/lib/indicators';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIndicatorCandles(candles: Candle[]) {
  return candles.map((c) => ({
    time: new Date(c.ts).toISOString(),
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));
}

function makeSignal(
  symbol: string, kind: Signal['kind'], side: Side,
  strength: number, confidence: number,
  entry: number, stop: number, target: number,
  meta: Record<string, unknown> = {},
): Signal {
  return {
    id: randomUUID(),
    ts: Date.now(),
    symbol, kind, side, strength, confidence,
    suggestedEntry: entry,
    suggestedStop: stop,
    suggestedTarget: target,
    meta,
  };
}

// ─── Momentum (SuperTrend + RSI crossover) ───────────────────────────────────

export function momentumSignal(symbol: string, candles: Candle[]): Signal | null {
  if (candles.length < 20) return null;
  const ic = toIndicatorCandles(candles);
  const { st, stx } = computeSuperTrend(ic);
  const rsi = computeRSI(ic);
  const n = candles.length - 1;

  const crossedUp  = stx[n] === 'up'   && stx[n - 1] === 'down';
  const crossedDown = stx[n] === 'down' && stx[n - 1] === 'up';
  if (!crossedUp && !crossedDown) return null;

  const side: Side = crossedUp ? 'BUY' : 'SELL';
  const ltp = candles[n].close;
  const atr = Math.abs(ltp - st[n]);
  const rsiVal = rsi[n];
  const confidence = crossedUp
    ? Math.min(100, 50 + (rsiVal - 40))
    : Math.min(100, 50 + (60 - rsiVal));

  return makeSignal(symbol, 'MOMENTUM', side, 75, confidence, ltp,
    side === 'BUY' ? ltp - atr * 1.5 : ltp + atr * 1.5,
    side === 'BUY' ? ltp + atr * 2.5 : ltp - atr * 2.5,
    { rsi: rsiVal, superTrend: st[n] },
  );
}

// ─── Mean-reversion (Bollinger Band touch) ───────────────────────────────────

export function meanReversionSignal(symbol: string, candles: Candle[], window = 20, stdDev = 2): Signal | null {
  if (candles.length < window + 1) return null;
  const closes = candles.map((c) => c.close);
  const slice = closes.slice(-window);
  const mean = slice.reduce((a, b) => a + b, 0) / window;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
  const sd = Math.sqrt(variance);
  const upper = mean + stdDev * sd;
  const lower = mean - stdDev * sd;
  const ltp = closes[closes.length - 1];

  if (ltp > upper) {
    return makeSignal(symbol, 'MEAN_REVERSION', 'SELL', 65, 70, ltp,
      upper + sd, mean, { upper, lower, mean });
  }
  if (ltp < lower) {
    return makeSignal(symbol, 'MEAN_REVERSION', 'BUY', 65, 70, ltp,
      lower - sd, mean, { upper, lower, mean });
  }
  return null;
}

// ─── Breakout (resistance/support breach with volume) ────────────────────────

export function breakoutSignal(symbol: string, candles: Candle[], lookback = 20): Signal | null {
  if (candles.length < lookback + 1) return null;
  const window = candles.slice(-lookback - 1, -1);
  const current = candles[candles.length - 1];
  const resistance = Math.max(...window.map((c) => c.high));
  const support    = Math.min(...window.map((c) => c.low));
  const avgVol = window.reduce((a, c) => a + c.volume, 0) / lookback;
  const volConfirm = current.volume > avgVol * 1.5;

  if (current.close > resistance && volConfirm) {
    const atr = resistance - support;
    return makeSignal(symbol, 'BREAKOUT', 'BUY', 80, volConfirm ? 80 : 60,
      current.close, current.close - atr * 0.5, current.close + atr * 1.5,
      { resistance, support, volRatio: current.volume / avgVol });
  }
  if (current.close < support && volConfirm) {
    const atr = resistance - support;
    return makeSignal(symbol, 'BREAKOUT', 'SELL', 80, volConfirm ? 80 : 60,
      current.close, current.close + atr * 0.5, current.close - atr * 1.5,
      { resistance, support, volRatio: current.volume / avgVol });
  }
  return null;
}
