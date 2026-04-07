// Technical indicators ported from the AliceBlue trading bot (ab_options.py)
// SuperTrend, ATR, EMA, RSI implementations in TypeScript

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IndicatorResult {
  candles: Candle[];
  atr: number[];
  superTrend: number[];
  superTrendDirection: ('up' | 'down' | 'none')[];
  rsi: number[];
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  signalReason: string;
}

/**
 * Exponential Moving Average (EMA)
 * Ported from Python EMA() function
 */
function computeEMA(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(0);

  // Calculate SMA for the first `period` values
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  if (period <= values.length) {
    result[period - 1] = sum / period;
  }

  // EMA using alpha = 1/period (same as Python code's alpha=True mode)
  const alpha = 1 / period;
  for (let i = period; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }

  return result;
}

/**
 * Average True Range (ATR)
 * Ported from Python ATR() function
 */
function computeATR(candles: Candle[], period: number): { tr: number[]; atr: number[] } {
  const tr: number[] = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hyc = Math.abs(candles[i].high - candles[i - 1].close);
    const lyc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.round(Math.max(hl, hyc, lyc) * 10) / 10;
  }

  const atr = computeEMA(tr, period);
  return { tr, atr };
}

/**
 * SuperTrend Indicator
 * Ported from Python SuperTrend() function
 * period=7, multiplier=2.5 (same defaults as the bot)
 */
export function computeSuperTrend(
  candles: Candle[],
  period: number = 7,
  multiplier: number = 2.5
): { atr: number[]; st: number[]; stx: ('up' | 'down' | 'none')[] } {
  const { atr } = computeATR(candles, period);
  const len = candles.length;

  const basicUB: number[] = new Array(len).fill(0);
  const basicLB: number[] = new Array(len).fill(0);
  const finalUB: number[] = new Array(len).fill(0);
  const finalLB: number[] = new Array(len).fill(0);
  const st: number[] = new Array(len).fill(0);
  const stx: ('up' | 'down' | 'none')[] = new Array(len).fill('none');

  // Compute basic upper and lower bands
  for (let i = 0; i < len; i++) {
    basicUB[i] = (candles[i].high + candles[i].low) / 2 + multiplier * atr[i];
    basicLB[i] = (candles[i].high + candles[i].low) / 2 - multiplier * atr[i];
  }

  // Compute final upper and lower bands
  for (let i = period; i < len; i++) {
    finalUB[i] =
      basicUB[i] < finalUB[i - 1] || candles[i - 1].close > finalUB[i - 1]
        ? basicUB[i]
        : finalUB[i - 1];

    finalLB[i] =
      basicLB[i] > finalLB[i - 1] || candles[i - 1].close < finalLB[i - 1]
        ? basicLB[i]
        : finalLB[i - 1];
  }

  // Set the SuperTrend value
  for (let i = period; i < len; i++) {
    if (st[i - 1] === finalUB[i - 1] && candles[i].close <= finalUB[i]) {
      st[i] = finalUB[i];
    } else if (st[i - 1] === finalUB[i - 1] && candles[i].close > finalUB[i]) {
      st[i] = finalLB[i];
    } else if (st[i - 1] === finalLB[i - 1] && candles[i].close >= finalLB[i]) {
      st[i] = finalLB[i];
    } else if (st[i - 1] === finalLB[i - 1] && candles[i].close < finalLB[i]) {
      st[i] = finalUB[i];
    } else {
      st[i] = 0;
    }

    // Mark the trend direction
    if (st[i] > 0) {
      stx[i] = candles[i].close < st[i] ? 'down' : 'up';
    }
  }

  return { atr, st, stx };
}

/**
 * Relative Strength Index (RSI)
 * Ported from Python RSI() function
 */
export function computeRSI(candles: Candle[], period: number = 7): number[] {
  const len = candles.length;
  const rsi: number[] = new Array(len).fill(0);
  const closes = candles.map((c) => c.close);

  if (len < 2) return rsi;

  const delta: number[] = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    delta[i] = closes[i] - closes[i - 1];
  }

  const up: number[] = delta.map((d) => (d > 0 ? d : 0));
  const down: number[] = delta.map((d) => (d < 0 ? Math.abs(d) : 0));

  // EWM with com=period-1 → alpha = 1/period
  const alpha = 1 / period;
  const rUp: number[] = new Array(len).fill(0);
  const rDown: number[] = new Array(len).fill(0);

  rUp[0] = up[0];
  rDown[0] = down[0];

  for (let i = 1; i < len; i++) {
    rUp[i] = alpha * up[i] + (1 - alpha) * rUp[i - 1];
    rDown[i] = alpha * down[i] + (1 - alpha) * rDown[i - 1];
  }

  for (let i = 0; i < len; i++) {
    if (rDown[i] === 0) {
      rsi[i] = 100;
    } else {
      rsi[i] = Math.round(100 - 100 / (1 + rUp[i] / rDown[i]));
    }
  }

  return rsi;
}

/**
 * Generate Buy/Sell Signal
 * Ported from Python get_buy_sell() function
 * 
 * Logic:
 * BUY:  ST crossover from down→up (last 6 candles: down,down,down,down,down,up) + RSI confirmation
 * SELL: ST crossover from up→down (last 6 candles: up,up,up,up,up,down) + RSI confirmation
 */
export function generateSignal(
  stx: ('up' | 'down' | 'none')[],
  rsi: number[],
  useRSI: boolean = true,
  rsiBuyParam: number = 40,
  rsiSellParam: number = 60
): { signal: 'BUY' | 'SELL' | 'NEUTRAL'; reason: string } {
  const len = stx.length;

  if (len < 6) {
    return { signal: 'NEUTRAL', reason: 'Not enough data (need at least 6 candles)' };
  }

  const last6 = stx.slice(-6);

  // BUY: SuperTrend crossover down → up
  if (
    last6[5] === 'up' &&
    last6[4] === 'down' &&
    last6[3] === 'down' &&
    last6[2] === 'down' &&
    last6[1] === 'down' &&
    last6[0] === 'down'
  ) {
    if (useRSI) {
      const currentRSI = rsi[len - 1];
      if (currentRSI > rsiBuyParam && currentRSI < rsiSellParam) {
        // RSI Rate of Change check
        if (len >= 3) {
          const c1 = (rsi[len - 2] - rsi[len - 3]) / (rsi[len - 3] || 1);
          const c2 = (rsi[len - 1] - rsi[len - 2]) / (rsi[len - 2] || 1);
          if (c2 > c1) {
            return {
              signal: 'BUY',
              reason: `SuperTrend crossed UP ↑ | RSI=${currentRSI} (momentum increasing, RoC: ${(c2 * 100).toFixed(1)}% > ${(c1 * 100).toFixed(1)}%)`,
            };
          } else {
            return {
              signal: 'NEUTRAL',
              reason: `SuperTrend UP but RSI momentum declining (RoC: ${(c2 * 100).toFixed(1)}% < ${(c1 * 100).toFixed(1)}%)`,
            };
          }
        }
        return {
          signal: 'BUY',
          reason: `SuperTrend crossed UP ↑ | RSI=${currentRSI} confirmed`,
        };
      } else {
        return {
          signal: 'NEUTRAL',
          reason: `SuperTrend UP but RSI=${currentRSI} out of range (${rsiBuyParam}-${rsiSellParam})`,
        };
      }
    }
    return { signal: 'BUY', reason: 'SuperTrend crossed UP ↑ (RSI disabled)' };
  }

  // SELL: SuperTrend crossover up → down
  if (
    last6[5] === 'down' &&
    last6[4] === 'up' &&
    last6[3] === 'up' &&
    last6[2] === 'up' &&
    last6[1] === 'up' &&
    last6[0] === 'up'
  ) {
    if (useRSI) {
      const currentRSI = rsi[len - 1];
      if (currentRSI < rsiSellParam && currentRSI > rsiBuyParam) {
        if (len >= 3) {
          const c1 = (rsi[len - 2] - rsi[len - 3]) / (rsi[len - 3] || 1);
          const c2 = (rsi[len - 1] - rsi[len - 2]) / (rsi[len - 2] || 1);
          if (c2 < c1) {
            return {
              signal: 'SELL',
              reason: `SuperTrend crossed DOWN ↓ | RSI=${currentRSI} (momentum decreasing, RoC: ${(c2 * 100).toFixed(1)}% < ${(c1 * 100).toFixed(1)}%)`,
            };
          } else {
            return {
              signal: 'NEUTRAL',
              reason: `SuperTrend DOWN but RSI momentum rising (RoC: ${(c2 * 100).toFixed(1)}% > ${(c1 * 100).toFixed(1)}%)`,
            };
          }
        }
        return {
          signal: 'SELL',
          reason: `SuperTrend crossed DOWN ↓ | RSI=${currentRSI} confirmed`,
        };
      } else {
        return {
          signal: 'NEUTRAL',
          reason: `SuperTrend DOWN but RSI=${currentRSI} out of range (${rsiBuyParam}-${rsiSellParam})`,
        };
      }
    }
    return { signal: 'SELL', reason: 'SuperTrend crossed DOWN ↓ (RSI disabled)' };
  }

  // No crossover
  const currentTrend = stx[len - 1];
  const currentRSI = rsi[len - 1];
  return {
    signal: 'NEUTRAL',
    reason: `Trend: ${currentTrend.toUpperCase()} | RSI: ${currentRSI} | No crossover detected`,
  };
}

/**
 * Run full analysis on candle data
 */
export function analyzeCandles(
  candles: Candle[],
  stPeriod: number = 7,
  stMultiplier: number = 2.5,
  rsiPeriod: number = 7
): IndicatorResult {
  const { atr, st, stx } = computeSuperTrend(candles, stPeriod, stMultiplier);
  const rsi = computeRSI(candles, rsiPeriod);
  const { signal, reason } = generateSignal(stx, rsi);

  return {
    candles,
    atr,
    superTrend: st,
    superTrendDirection: stx,
    rsi,
    signal,
    signalReason: reason,
  };
}
