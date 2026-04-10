import { randomUUID } from 'crypto';
import type { Candle, Signal, SignalKind } from '../types';

/**
 * Intraday Put/Call Strategy for Nifty 50
 * Decides between buying a Call or Put based on momentum, volatility, and RSI
 */
export const niftyIntradayOptionStrategy = (symbol: string, candles: Candle[]): Signal | null => {
  if (candles.length < 30) return null;

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const close = latest.close;
  const open = latest.open;
  const high = latest.high;
  const low = latest.low;
  const volume = latest.volume;

  // --- 1. Volatility Filter: Use ATR (approximated over last 14 candles)
  const atrPeriod = 14;
  const recent = candles.slice(-atrPeriod - 1);
  const trSum = recent.reduce((sum, curr, i) => {
    if (i === 0) return sum;
    const prev = recent[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    return sum + tr;
  }, 0);
  const atr = trSum / atrPeriod;
  const normalizedVolatility = atr / close;

  // Low volatility? Avoid trading
  if (normalizedVolatility < 0.0015) return null; // Nifty 50: ~15–20 points ATR on avg

  // --- 2. Momentum: Strong move in one direction?
  const strongBullCandle = open < close && (close - open) > 1.5 * (high - low) * 0.5;
  const strongBearCandle = open > close && (open - close) > 1.5 * (high - low) * 0.5;

  // --- 3. RSI Filter (14-period)
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i].close - recent[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  const rsi = avgLoss === 0 ? 30 : 100 - 100 / (1 + rs);

  // --- 4. Volume Confirmation
  const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const highVolume = volume > avgVolume * 1.3;

  // --- 5. Time Filter: Trade only between 9:45 AM and 2:30 PM IST
  const ts = new Date(latest.ts);
  const hour = ts.getUTCHours() + 5;
  const min = ts.getUTCMinutes();
  const istHour = (hour >= 24 ? hour - 24 : hour);
  const istMinute = min;
  const inTradingWindow = (istHour > 9 || (istHour === 9 && istMinute >= 45)) && (istHour < 14 || (istHour === 14 && istMinute <= 30));
  if (!inTradingWindow) return null;

  // --- 6. Signal Logic
  let side: 'BUY' | 'SELL' = 'BUY';
  let reason: string;
  let kind: SignalKind = 'GAMMA_SCALP';

  // Bullish: Strong green candle + RSI > 50 or recovering from 40–50 + volume
  if (strongBullCandle && highVolume && rsi > 45 && close > previous.close) {
    side = 'BUY'; // Buy Call
    reason = `Bull momentum: RSI=${rsi.toFixed(1)}, Vol=${volume}, ATR=${atr.toFixed(1)}`;
    kind = 'MOMENTUM';
  }
  // Bearish: Strong red candle + RSI < 55 or rejecting 50–60 + volume
  else if (strongBearCandle && highVolume && rsi < 55 && close < previous.close) {
    side = 'SELL'; // Buy Put
    reason = `Bear momentum: RSI=${rsi.toFixed(1)}, Vol=${volume}, ATR=${atr.toFixed(1)}`;
    kind = 'MOMENTUM';
  } else {
    return null; // No clear edge
  }

  // --- 7. Risk Levels
  const atrMultiplier = 1.5;
  const stopDistance = atr * atrMultiplier;
  const targetDistance = atr * (atrMultiplier + 0.5); // 1:1.3 RR approx

  const suggestedStop = side === 'BUY' ? close - stopDistance : close + stopDistance;
  const suggestedTarget = side === 'BUY' ? close + targetDistance : close - targetDistance;

  // Avoid trading if stop is too wide or too narrow
  if (stopDistance / close < 0.001 || stopDistance / close > 0.01) return null;

  // --- 8. Generate Signal
  return {
    id: randomUUID(),
    symbol,
    side,
    kind,
    suggestedEntry: close,
    suggestedStop,
    suggestedTarget,
    confidence: Math.min(0.3 + (normalizedVolatility * 500), 0.8), // higher vol = higher confidence
    createdAt: latest.ts,
    meta: {
      rsi,
      atr,
      volatility: normalizedVolatility,
      volumeRatio: volume / avgVolume,
      candleStrength: strongBullCandle || strongBearCandle ? 1 : 0,
    },
  };
};
