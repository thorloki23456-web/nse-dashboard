import type { Order, PortfolioSnapshot, Signal } from '../types';

// Supabase client is injected — no direct import to keep this module testable
export interface SupabaseClient {
  from: (table: string) => {
    insert: (rows: unknown[]) => Promise<{ error: unknown }>;
    upsert: (rows: unknown[], opts?: unknown) => Promise<{ error: unknown }>;
    select: (cols?: string) => { eq: (col: string, val: unknown) => Promise<{ data: unknown; error: unknown }> };
  };
}

export class TradingDB {
  constructor(private db: SupabaseClient) {}

  async saveSignal(s: Signal): Promise<void> {
    const { error } = await this.db.from('signals').insert([{
      id: s.id, ts: new Date(s.ts).toISOString(), symbol: s.symbol,
      kind: s.kind, side: s.side, strength: s.strength, confidence: s.confidence,
      suggested_entry: s.suggestedEntry, suggested_stop: s.suggestedStop,
      suggested_target: s.suggestedTarget, meta: s.meta,
    }]);
    if (error) console.error('[TradingDB] saveSignal', error);
  }

  async saveOrder(o: Order): Promise<void> {
    const { error } = await this.db.from('orders').upsert([{
      id: o.id, signal_id: o.signalId, symbol: o.symbol,
      side: o.side, type: o.type, qty: o.qty,
      limit_price: o.limitPrice ?? null, stop_price: o.stopPrice ?? null,
      status: o.status, filled_qty: o.filledQty, avg_fill_price: o.avgFillPrice,
      slippage: o.slippage,
      created_at: new Date(o.createdAt).toISOString(),
      updated_at: new Date(o.updatedAt).toISOString(),
    }], { onConflict: 'id' });
    if (error) console.error('[TradingDB] saveOrder', error);
  }

  async saveSnapshot(snap: PortfolioSnapshot): Promise<void> {
    const { error } = await this.db.from('portfolio_snapshots').insert([{
      ts: new Date(snap.ts).toISOString(),
      cash: snap.cash, equity: snap.equity,
      daily_pnl: snap.dailyPnl, total_pnl: snap.totalPnl,
      positions: snap.positions,
    }]);
    if (error) console.error('[TradingDB] saveSnapshot', error);
  }
}
