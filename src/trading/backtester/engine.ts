import { randomUUID } from 'crypto';
import type {
  Candle, Signal, Order, Fill, BacktestConfig,
  BacktestResult, BacktestTrade, PerformanceMetrics, PortfolioSnapshot,
} from '../types';
import { Portfolio } from '../portfolio/tracker';
import { RiskManager } from '../risk/manager';

export type StrategyFn = (symbol: string, candles: Candle[]) => Signal | null;

/** Seeded LCG — deterministic, no external deps */
function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0xffffffff; };
}

/** Synchronous fill simulation — no async needed in backtest */
function simulateFill(signal: Signal, qty: number, slippagePct: number, prng: () => number): Fill {
  const jitter = 0.75 + prng() * 0.5;
  const slip = signal.suggestedEntry * slippagePct * jitter;
  return {
    orderId: randomUUID(),
    qty,
    price: signal.side === 'BUY' ? signal.suggestedEntry + slip : signal.suggestedEntry - slip,
    ts: Date.now(),
    latencyMs: 0,
  };
}

function makeFilledOrder(signal: Signal, fill: Fill): Order {
  return {
    id: fill.orderId,
    signalId: signal.id,
    symbol: signal.symbol,
    side: signal.side,
    type: 'MARKET',
    qty: fill.qty,
    status: 'FILLED',
    filledQty: fill.qty,
    avgFillPrice: fill.price,
    slippage: Math.abs(fill.price - signal.suggestedEntry),
    createdAt: fill.ts,
    updatedAt: fill.ts,
  };
}

export class Backtester {
  private prng: () => number;

  constructor(private cfg: BacktestConfig) {
    this.prng = makePrng(cfg.seed ?? 42);
  }

  run(symbol: string, candles: Candle[], strategy: StrategyFn): BacktestResult {
    const bars = candles.filter((c) => c.ts >= this.cfg.startTs && c.ts <= this.cfg.endTs);
    if (bars.length < 2) return this.emptyResult();

    const portfolio = new Portfolio(this.cfg.initialCapital);
    const risk = new RiskManager({
      maxDrawdownPct: 0.20, dailyLossLimitPct: 0.03,
      maxPositionSizePct: 0.05, maxOpenPositions: 5, maxOrderQty: 1000,
    });

    const trades: BacktestTrade[] = [];
    const equity: { ts: number; value: number }[] = [];
    const open = new Map<string, { signal: Signal; entryPrice: number; qty: number; entryTs: number }>();

    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i];
      portfolio.markToMarket({ [symbol]: bar.close });

      // ── Check exits ──────────────────────────────────────────────────────
      for (const [id, pos] of open) {
        const hitStop   = pos.signal.side === 'BUY'  ? bar.low  <= pos.signal.suggestedStop
                        : bar.high >= pos.signal.suggestedStop;
        const hitTarget = pos.signal.side === 'BUY'  ? bar.high >= pos.signal.suggestedTarget
                        : bar.low  <= pos.signal.suggestedTarget;

        if (hitStop || hitTarget) {
          const rawExit = hitTarget ? pos.signal.suggestedTarget : pos.signal.suggestedStop;
          const slip = rawExit * this.cfg.slippagePct * (0.75 + this.prng() * 0.5);
          const exitPrice = pos.signal.side === 'BUY' ? rawExit - slip : rawExit + slip;
          const pnl = (exitPrice - pos.entryPrice) * pos.qty * (pos.signal.side === 'BUY' ? 1 : -1);
          const commission = exitPrice * pos.qty * this.cfg.commissionPct * 2;
          trades.push({
            symbol, side: pos.signal.side,
            entryTs: pos.entryTs, exitTs: bar.ts,
            entryPrice: pos.entryPrice, exitPrice,
            qty: pos.qty, pnl: pnl - commission, commission,
          });
          open.delete(id);
        }
      }

      // ── Generate signal ──────────────────────────────────────────────────
      const signal = strategy(symbol, bars.slice(0, i + 1));
      if (signal) {
        const snap = portfolio.snapshot();
        const check = risk.check(signal, snap);
        if (check.approved) {
          const qty = risk.positionSize(signal, snap);
          if (qty > 0) {
            const fill = simulateFill(signal, qty, this.cfg.slippagePct, this.prng);
            const order = makeFilledOrder(signal, fill);
            portfolio.applyFill(order, fill, this.cfg.commissionPct);
            open.set(signal.id, { signal, entryPrice: fill.price, qty, entryTs: bar.ts });
          }
        }
      }

      equity.push({ ts: bar.ts, value: portfolio.snapshot().equity });
    }

    return { trades, equity, metrics: this.computeMetrics(trades, equity) };
  }

  private computeMetrics(trades: BacktestTrade[], equity: { ts: number; value: number }[]): PerformanceMetrics {
    if (trades.length === 0) return this.zeroMetrics();

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const initial = this.cfg.initialCapital;
    const final = equity.at(-1)?.value ?? initial;
    const totalReturn = (final - initial) / initial;
    const years = (this.cfg.endTs - this.cfg.startTs) / (365.25 * 86400_000);
    const cagr = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0;

    const dailyReturns = equity.slice(1).map((e, i) => (e.value - equity[i].value) / equity[i].value);
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
    const std  = Math.sqrt(dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length || 1));
    const down = Math.sqrt(dailyReturns.filter((r) => r < 0).reduce((a, b) => a + b ** 2, 0) / (dailyReturns.length || 1));
    const sharpe  = std  > 0 ? (mean / std)  * Math.sqrt(252) : 0;
    const sortino = down > 0 ? (mean / down) * Math.sqrt(252) : 0;

    let peak = initial, maxDD = 0, ddStart = 0, maxDDDur = 0;
    equity.forEach(({ value }, i) => {
      if (value > peak) { peak = value; ddStart = i; }
      const dd = (peak - value) / peak;
      if (dd > maxDD) { maxDD = dd; maxDDDur = i - ddStart; }
    });

    const grossWin  = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

    return {
      totalReturn, cagr, sharpe, sortino,
      maxDrawdown: maxDD, maxDrawdownDuration: maxDDDur,
      winRate: wins.length / trades.length,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      totalTrades: trades.length,
    };
  }

  private emptyResult(): BacktestResult {
    return { trades: [], equity: [], metrics: this.zeroMetrics() };
  }

  private zeroMetrics(): PerformanceMetrics {
    return { totalReturn: 0, cagr: 0, sharpe: 0, sortino: 0,
      maxDrawdown: 0, maxDrawdownDuration: 0, winRate: 0, profitFactor: 0, totalTrades: 0 };
  }
}
