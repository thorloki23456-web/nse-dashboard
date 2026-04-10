import { randomUUID } from 'crypto';
import type { Candle, Signal, SignalKind } from '../types';

/**
 * Intraday Options Strategy for Nifty 50
 * Decides between BUY CALL or BUY PUT based on confluence of:
 * - Opening range breakout
 * - Volume-weighted momentum
 * - RSI divergence
 * - Volatility contraction/expansion
 */
export class IntradayOptionsStrategy {
  private readonly lookback: number;
  private readonly orbPeriod: number;
  private readonly rsiPeriod: number;
  private readonly overboughtLevel: number;
  private readonly oversoldLevel: number;
  private readonly minVolumeFactor: number;

  constructor() {
    this.lookback = 20;
    this.orbPeriod = 15; // 15-minute opening range
    this.rsiPeriod = 14;
    this.overboughtLevel = 70;
    this.oversoldLevel = 30;
    this.minVolumeFactor = 1.2; // 20% above average
  }

  generateSignal(symbol: string, candles: Candle[]): Signal | null {
    if (candles.length < this.lookback + this.orbPeriod) return null;

    const recent = candles.slice(-this.lookback);
    const current = recent[recent.length - 1];
    const prev = recent[recent.length - 2];

    // --- 1. Opening Range Breakout (ORB) ---
    const morningCandles = candles.slice(-this.lookback - this.orbPeriod, -this.lookback);
    if (morningCandles.length < this.orbPeriod) return null;

    const orbHigh = Math.max(...morningCandles.map(c => c.high));
    const orbLow = Math.min(...morningCandles.map(c => c.low));
    const inOrbPeriod = current.ts < morningCandles[0].ts + this.orbPeriod * 60 * 1000;

    const orbBullishBreakout = !inOrbPeriod && current.close > orbHigh && prev.close <= orbHigh;
    const orbBearishBreakout = !inOrbPeriod && current.close < orbLow && prev.close >= orbLow;

    // --- 2. Volume Momentum ---
    const avgVolume = morningCandles.reduce((a, c) => a + c.volume, 0) / morningCandles.length;
    const volumeSurge = current.volume > avgVolume * this.minVolumeFactor;

    // --- 3. RSI ---
    const closes = candles.slice(-this.rsiPeriod - 1).map(c => c.close);
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    const rsiOversold = rsi < this.oversoldLevel;
    const rsiOverbought = rsi > this.overboughtLevel;

    // --- 4. Volatility Contraction (Bollinger Band Width) ---
    const middle = closes.reduce((a, b) => a + b, 0) / closes.length;
    const variance = closes.reduce((a, b) => a + (b - middle) ** 2, 0) / closes.length;
    const std = Math.sqrt(variance);
    const upper = middle + 2 * std;
    const lower = middle - 2 * std;
    const bbWidth = (upper - lower) / middle;
    const bbWidthAvg = this.calcSma(candles.slice(-20).map(c => {
      const mid = (c.high + c.low) / 2;
      const stdev = Math.sqrt(candles.slice(-14).reduce((a, b) => a + ((b.high + b.low) / 2 - mid) ** 2, 0) / 14);
      return ((mid + 2 * stdev) - (mid - 2 * stdev)) / mid;
    }), 5);

    const volatilityExpansion = bbWidth > bbWidthAvg * 1.1;

    // --- Signal Logic ---
    let side: 'BUY' | null = null;
    let kind: SignalKind = 'CONFLUENCE'; // Default to CONFLUENCE
    let confidence = 0.5;

    // Strong bullish setup
    if ((orbBullishBreakout || (rsiOversold && current.close > prev.close)) && volumeSurge) {
      side = 'BUY';
      kind = 'BREAKOUT';
      confidence = volatilityExpansion ? 0.8 : 0.6;
    }
    // Strong bearish setup
    else if ((orbBearishBreakout || (rsiOverbought && current.close < prev.close)) && volumeSurge) {
      side = 'BUY';
      kind = 'BREAKOUT';
      confidence = volatilityExpansion ? 0.8 : 0.6;
    }
    // Fallback: momentum
    else if (current.close > prev.close && current.close > closes[closes.length - 3]) {
      side = 'BUY';
      kind = 'MOMENTUM';
      confidence = 0.55;
    }
    else if (current.close < prev.close && current.close < closes[closes.length - 3]) {
      side = 'BUY';
      kind = 'MOMENTUM';
      confidence = 0.55;
    }

    if (!side) return null;

    // For options: BUY CALL = bullish, BUY PUT = bearish
    // But our signal side is always BUY — we encode direction in the symbol or meta
    const isCall = side === 'BUY' && kind === 'BREAKOUT' && orbBullishBreakout;
    const isPut = side === 'BUY' && kind === 'BREAKOUT' && orbBearishBreakout;

    const entry = current.close;
    const stopDistance = std * 1.5;
    const targetDistance = stopDistance * 1.5;

    const suggestedStop = isCall ? entry - stopDistance : entry + stopDistance;
    const suggestedTarget = isCall ? entry + targetDistance : entry - targetDistance;

    return {
      id: randomUUID(),
      ts: current.ts,
      symbol: isCall ? `${symbol}_CE` : `${symbol}_PE`,
      side: 'BUY',
      kind: kind,
      strength: Math.round(confidence * 100),
      confidence: Math.round(confidence * 100),
      suggestedEntry: entry,
      suggestedStop,
      suggestedTarget,
      meta: {
        strategy: 'intraday-options-v1',
        reason: isCall
          ? 'ORB Bullish Breakout + Volume Surge'
          : isPut
            ? 'ORB Bearish Breakout + Volume Surge'
            : 'Momentum Follow-Through',
        rsi,
        volatilityExpansion,
        orbBreakout: orbBullishBreakout || orbBearishBreakout,
        volumeSurge,
        direction: isCall ? 'CALL' : 'PUT',
      },
    };
  }

  private calcSma(series: number[], period: number): number {
    if (series.length < period) return series.reduce((a, b) => a + b, 0) / series.length;
    const slice = series.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }
}
