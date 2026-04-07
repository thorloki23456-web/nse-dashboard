import { Backtester } from '@/trading/backtester/engine';
import { momentumSignal } from '@/trading/signals/generators';
import type { Candle } from '@/trading/types';

function makeCandles(n: number, startPrice = 100, trend: 'up' | 'down' | 'flat' = 'up'): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const delta = trend === 'up' ? 0.5 : trend === 'down' ? -0.5 : 0;
    price += delta + (Math.sin(i * 0.3) * 0.2);
    candles.push({
      ts: 1_700_000_000_000 + i * 60_000,
      open: price - 0.1, high: price + 0.5,
      low: price - 0.5, close: price, volume: 10000 + i * 100,
    });
  }
  return candles;
}

describe('Backtester', () => {
  const candles = makeCandles(100, 22000, 'up');
  const cfg = {
    startTs: candles[0].ts, endTs: candles.at(-1)!.ts,
    initialCapital: 100000, commissionPct: 0.0003, slippagePct: 0.0002, seed: 42,
  };

  it('returns empty result for insufficient candles', () => {
    const bt = new Backtester(cfg);
    const result = bt.run('TEST', candles.slice(0, 1), momentumSignal);
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.totalTrades).toBe(0);
  });

  it('produces deterministic results with same seed', () => {
    const bt1 = new Backtester({ ...cfg, seed: 99 });
    const bt2 = new Backtester({ ...cfg, seed: 99 });
    const r1 = bt1.run('TEST', candles, momentumSignal);
    const r2 = bt2.run('TEST', candles, momentumSignal);
    expect(r1.metrics.totalReturn).toBe(r2.metrics.totalReturn);
    expect(r1.trades.length).toBe(r2.trades.length);
  });

  it('produces different results with different seeds when trades exist', () => {
    const bt1 = new Backtester({ ...cfg, seed: 1 });
    const bt2 = new Backtester({ ...cfg, seed: 2 });
    const r1 = bt1.run('TEST', candles, momentumSignal);
    const r2 = bt2.run('TEST', candles, momentumSignal);
    // If trades fired, slippage differs between seeds
    if (r1.trades.length > 0 && r2.trades.length > 0) {
      expect(r1.metrics.totalReturn).not.toBe(r2.metrics.totalReturn);
    } else {
      // No trades — both return 0, which is still deterministic
      expect(r1.metrics.totalReturn).toBe(r2.metrics.totalReturn);
    }
  });

  it('equity curve length matches bar count', () => {
    const bt = new Backtester(cfg);
    const result = bt.run('TEST', candles, momentumSignal);
    expect(result.equity.length).toBe(candles.length - 1);
  });

  it('metrics are finite numbers', () => {
    const bt = new Backtester(cfg);
    const { metrics } = bt.run('TEST', candles, momentumSignal);
    expect(Number.isFinite(metrics.sharpe)).toBe(true);
    expect(Number.isFinite(metrics.maxDrawdown)).toBe(true);
    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(1);
    expect(metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(metrics.winRate).toBeLessThanOrEqual(1);
  });

  it('all trades have valid pnl and timestamps', () => {
    const bt = new Backtester(cfg);
    const { trades } = bt.run('TEST', candles, momentumSignal);
    trades.forEach((t) => {
      expect(Number.isFinite(t.pnl)).toBe(true);
      expect(t.exitTs).toBeGreaterThan(t.entryTs);
      expect(t.qty).toBeGreaterThan(0);
    });
  });
});

describe('RiskManager', () => {
  const { RiskManager } = require('@/trading/risk/manager');
  const risk = new RiskManager({
    maxDrawdownPct: 0.10, dailyLossLimitPct: 0.02,
    maxPositionSizePct: 0.05, maxOpenPositions: 3, maxOrderQty: 100,
  });

  const baseSnap = {
    ts: Date.now(), cash: 100000, equity: 100000,
    positions: [], dailyPnl: 0, totalPnl: 0,
  };

  const baseSignal = {
    id: '1', ts: Date.now(), symbol: 'NIFTY', kind: 'MOMENTUM' as const,
    side: 'BUY' as const, strength: 80, confidence: 75,
    suggestedEntry: 22000, suggestedStop: 21800, suggestedTarget: 22400, meta: {},
  };

  it('approves valid signal', () => {
    expect(risk.check(baseSignal, baseSnap).approved).toBe(true);
  });

  it('blocks on daily loss limit', () => {
    const snap = { ...baseSnap, dailyPnl: -2500 }; // -2.5% of 100k
    expect(risk.check(baseSignal, snap).approved).toBe(false);
    expect(risk.check(baseSignal, snap).reason).toBe('DAILY_LOSS');
  });

  it('blocks when max positions reached', () => {
    const snap = { ...baseSnap, positions: [1, 2, 3].map((i) => ({
      symbol: `SYM${i}`, qty: 1, avgCost: 100, unrealisedPnl: 0, realisedPnl: 0, openedAt: 0,
    })) };
    expect(risk.check(baseSignal, snap).approved).toBe(false);
    expect(risk.check(baseSignal, snap).reason).toBe('POSITION_LIMIT');
  });

  it('positionSize returns positive integer', () => {
    const qty = risk.positionSize(baseSignal, baseSnap);
    expect(qty).toBeGreaterThan(0);
    expect(Number.isInteger(qty)).toBe(true);
    expect(qty).toBeLessThanOrEqual(100);
  });
});

describe('Signal generators', () => {
  const { meanReversionSignal, breakoutSignal } = require('@/trading/signals/generators');

  it('meanReversionSignal returns null for flat data', () => {
    const flat = makeCandles(30, 100, 'flat');
    expect(meanReversionSignal('TEST', flat)).toBeNull();
  });

  it('breakoutSignal returns BUY on upward breakout with volume', () => {
    const candles = makeCandles(25, 100, 'flat');
    // Force a breakout on the last bar
    candles[candles.length - 1] = {
      ...candles[candles.length - 1],
      close: 120, high: 121, volume: 500000,
    };
    const signal = breakoutSignal('TEST', candles);
    expect(signal?.side).toBe('BUY');
    expect(signal?.kind).toBe('BREAKOUT');
  });

  it('signals have required fields', () => {
    const candles = makeCandles(25, 100, 'flat');
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 120, high: 121, volume: 500000 };
    const signal = breakoutSignal('TEST', candles);
    if (signal) {
      expect(signal.id).toBeTruthy();
      expect(signal.suggestedStop).toBeLessThan(signal.suggestedEntry);
      expect(signal.suggestedTarget).toBeGreaterThan(signal.suggestedEntry);
    }
  });
});
