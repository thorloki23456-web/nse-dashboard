import type { AlertPayload, Signal, Order, PerformanceMetrics } from '../types';

interface TelegramConfig {
  botToken: string;
  chatId: string;
  throttleMs?: number;   // min ms between messages (default 1000)
  dryRun?: boolean;
}

const EMOJI: Record<string, string> = {
  INFO: 'ℹ️', WARN: '⚠️', CRITICAL: '🚨',
  BUY: '🟢', SELL: '🔴', FILLED: '✅', REJECTED: '❌',
};

export class TelegramAlerter {
  private lastSentAt = 0;
  private queue: AlertPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cfg: TelegramConfig) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  signal(s: Signal): void {
    this.enqueue({
      level: 'INFO',
      title: `${EMOJI[s.side]} Signal: ${s.kind} ${s.side} ${s.symbol}`,
      body: [
        `Strength: ${s.strength} | Confidence: ${s.confidence}`,
        `Entry: ${s.suggestedEntry.toFixed(2)} | Stop: ${s.suggestedStop.toFixed(2)} | Target: ${s.suggestedTarget.toFixed(2)}`,
      ].join('\n'),
      ts: s.ts,
      meta: s.meta,
    });
  }

  order(o: Order): void {
    const level = o.status === 'REJECTED' ? 'WARN' : 'INFO';
    this.enqueue({
      level,
      title: `${EMOJI[o.status] ?? ''} Order ${o.status}: ${o.symbol}`,
      body: `${o.side} ${o.filledQty}@${o.avgFillPrice.toFixed(2)} | Slip: ${o.slippage.toFixed(2)}`,
      ts: o.updatedAt,
    });
  }

  risk(event: string, detail: string): void {
    this.enqueue({ level: 'CRITICAL', title: `${EMOJI.CRITICAL} Risk: ${event}`, body: detail, ts: Date.now() });
  }

  metrics(m: PerformanceMetrics): void {
    this.enqueue({
      level: 'INFO',
      title: '📊 Backtest / Session Metrics',
      body: [
        `Return: ${(m.totalReturn * 100).toFixed(2)}% | CAGR: ${(m.cagr * 100).toFixed(2)}%`,
        `Sharpe: ${m.sharpe.toFixed(2)} | Sortino: ${m.sortino.toFixed(2)}`,
        `MaxDD: ${(m.maxDrawdown * 100).toFixed(2)}% | WinRate: ${(m.winRate * 100).toFixed(1)}%`,
        `Trades: ${m.totalTrades} | PF: ${isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}`,
      ].join('\n'),
      ts: Date.now(),
    });
  }

  // ── Batched flush ──────────────────────────────────────────────────────────

  private enqueue(payload: AlertPayload): void {
    this.queue.push(payload);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 500);
    }
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.queue.length === 0) return;

    const throttle = this.cfg.throttleMs ?? 1000;
    const now = Date.now();
    if (now - this.lastSentAt < throttle) {
      // Re-schedule
      this.flushTimer = setTimeout(() => this.flush(), throttle - (now - this.lastSentAt));
      return;
    }

    const batch = this.queue.splice(0);
    const text = batch.map((p) => `*${p.title}*\n${p.body}`).join('\n\n---\n\n');
    await this.send(text);
    this.lastSentAt = Date.now();
  }

  private async send(text: string): Promise<void> {
    if (this.cfg.dryRun) {
      console.log('[TelegramAlerter DRY-RUN]', text);
      return;
    }
    const url = `https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.cfg.chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      console.error('[TelegramAlerter] send failed', res.status, await res.text());
    }
  }
}
