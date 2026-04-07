import type { Signal, PortfolioSnapshot, RiskConfig, RiskCheckResult, Order } from '../types';

export class RiskManager {
  constructor(private cfg: RiskConfig) {}

  check(signal: Signal, portfolio: PortfolioSnapshot): RiskCheckResult {
    const equity = portfolio.equity;

    // Daily loss limit
    if (portfolio.dailyPnl < -equity * this.cfg.dailyLossLimitPct) {
      return { approved: false, reason: 'DAILY_LOSS',
        detail: `Daily PnL ${portfolio.dailyPnl.toFixed(0)} breaches ${(this.cfg.dailyLossLimitPct * 100).toFixed(1)}% limit` };
    }

    // Max drawdown
    const peak = portfolio.cash + portfolio.positions.reduce((s, p) => s + Math.abs(p.qty) * p.avgCost, 0);
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdown > this.cfg.maxDrawdownPct) {
      return { approved: false, reason: 'MAX_DRAWDOWN',
        detail: `Drawdown ${(drawdown * 100).toFixed(1)}% exceeds ${(this.cfg.maxDrawdownPct * 100).toFixed(1)}%` };
    }

    // Max open positions
    if (portfolio.positions.length >= this.cfg.maxOpenPositions) {
      return { approved: false, reason: 'POSITION_LIMIT',
        detail: `${portfolio.positions.length} open positions at limit` };
    }

    return { approved: true };
  }

  /** Kelly-fractioned position size in units */
  positionSize(signal: Signal, portfolio: PortfolioSnapshot, winRate = 0.55, rr = 1.5): number {
    const kelly = Math.max(0, winRate - (1 - winRate) / rr) * 0.25; // quarter-Kelly
    const maxRisk = portfolio.equity * Math.min(kelly, this.cfg.maxPositionSizePct);
    const riskPerUnit = Math.abs(signal.suggestedEntry - signal.suggestedStop);
    if (riskPerUnit <= 0) return 0;
    return Math.min(
      Math.floor(maxRisk / riskPerUnit),
      this.cfg.maxOrderQty,
    );
  }
}
