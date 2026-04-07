import type { Fill, Order, Position, PortfolioSnapshot } from '../types';

export class Portfolio {
  private cash: number;
  private positions = new Map<string, Position>();
  private realisedPnl = 0;
  private dailyPnl = 0;
  private dayStartEquity: number;

  constructor(initialCapital: number) {
    this.cash = initialCapital;
    this.dayStartEquity = initialCapital;
  }

  applyFill(order: Order, fill: Fill, commissionPct = 0.0003): void {
    const cost = fill.price * fill.qty;
    const commission = cost * commissionPct;

    if (order.side === 'BUY') {
      this.cash -= cost + commission;
      const pos = this.positions.get(order.symbol);
      if (pos) {
        const totalQty = pos.qty + fill.qty;
        pos.avgCost = (pos.avgCost * pos.qty + fill.price * fill.qty) / totalQty;
        pos.qty = totalQty;
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol, qty: fill.qty, avgCost: fill.price,
          unrealisedPnl: 0, realisedPnl: 0, openedAt: fill.ts,
        });
      }
    } else {
      const pos = this.positions.get(order.symbol);
      if (!pos) return;
      const pnl = (fill.price - pos.avgCost) * fill.qty - commission;
      this.realisedPnl += pnl;
      this.dailyPnl += pnl;
      this.cash += cost - commission;
      pos.realisedPnl += pnl;
      pos.qty -= fill.qty;
      if (pos.qty <= 0) this.positions.delete(order.symbol);
    }
  }

  markToMarket(prices: Record<string, number>): void {
    for (const [sym, pos] of this.positions) {
      const ltp = prices[sym] ?? pos.avgCost;
      pos.unrealisedPnl = (ltp - pos.avgCost) * pos.qty;
    }
  }

  resetDailyPnl(): void {
    this.dayStartEquity = this.snapshot().equity;
    this.dailyPnl = 0;
  }

  snapshot(): PortfolioSnapshot {
    const positions = [...this.positions.values()];
    const unrealised = positions.reduce((s, p) => s + p.unrealisedPnl, 0);
    return {
      ts: Date.now(),
      cash: this.cash,
      equity: this.cash + unrealised,
      positions,
      dailyPnl: this.dailyPnl,
      totalPnl: this.realisedPnl + unrealised,
    };
  }
}
