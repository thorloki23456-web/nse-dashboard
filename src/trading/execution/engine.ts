import { randomUUID } from 'crypto';
import type { Signal, Order, Fill, OrderType, PortfolioSnapshot } from '../types';
import { RiskManager } from '../risk/manager';

export interface ExecutionConfig {
  slippagePct: number;    // e.g. 0.0002
  latencyMs: number;      // simulated or real
  dryRun: boolean;
  defaultOrderType: OrderType;
}

export interface ExecutionResult {
  order: Order;
  fill: Fill | null;
  blocked?: string;
}

export class ExecutionEngine {
  constructor(
    private cfg: ExecutionConfig,
    private risk: RiskManager,
  ) {}

  async execute(signal: Signal, portfolio: PortfolioSnapshot): Promise<ExecutionResult> {
    // Risk gate
    const check = this.risk.check(signal, portfolio);
    if (!check.approved) {
      return { order: this.rejectedOrder(signal, check.detail ?? 'risk'), fill: null, blocked: check.detail };
    }

    const qty = this.risk.positionSize(signal, portfolio);
    if (qty <= 0) {
      return { order: this.rejectedOrder(signal, 'zero qty'), fill: null, blocked: 'zero qty' };
    }

    const order: Order = {
      id: randomUUID(),
      signalId: signal.id,
      symbol: signal.symbol,
      side: signal.side,
      type: this.cfg.defaultOrderType,
      qty,
      limitPrice: this.cfg.defaultOrderType === 'LIMIT' ? signal.suggestedEntry : undefined,
      stopPrice: signal.suggestedStop,
      status: 'PENDING',
      filledQty: 0,
      avgFillPrice: 0,
      slippage: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.cfg.dryRun) {
      order.status = 'FILLED';
      const fill = this.simulateFill(order, signal.suggestedEntry);
      order.filledQty = fill.qty;
      order.avgFillPrice = fill.price;
      order.slippage = Math.abs(fill.price - signal.suggestedEntry);
      order.updatedAt = Date.now();
      return { order, fill };
    }

    // Live path — caller is responsible for wiring to broker API
    order.status = 'OPEN';
    return { order, fill: null };
  }

  private simulateFill(order: Order, marketPrice: number): Fill {
    const slip = marketPrice * this.cfg.slippagePct;
    const fillPrice = order.side === 'BUY' ? marketPrice + slip : marketPrice - slip;
    return {
      orderId: order.id,
      qty: order.qty,
      price: fillPrice,
      ts: Date.now() + this.cfg.latencyMs,
      latencyMs: this.cfg.latencyMs,
    };
  }

  private rejectedOrder(signal: Signal, reason: string): Order {
    return {
      id: randomUUID(),
      signalId: signal.id,
      symbol: signal.symbol,
      side: signal.side,
      type: 'MARKET',
      qty: 0,
      status: 'REJECTED',
      filledQty: 0,
      avgFillPrice: 0,
      slippage: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: reason,
    } as unknown as Order;
  }
}
