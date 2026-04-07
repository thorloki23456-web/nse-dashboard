import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { momentumSignal, breakoutSignal, meanReversionSignal } from '@/trading/signals/generators';
import { ExecutionEngine } from '@/trading/execution/engine';
import { RiskManager } from '@/trading/risk/manager';
import { Portfolio } from '@/trading/portfolio/tracker';
import { TelegramAlerter } from '@/trading/alerts/telegram';
import { TradingDB } from '@/trading/db/client';
import type { Candle } from '@/trading/types';

function getEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol, candles }: { symbol: string; candles: Candle[] } = await req.json();
    if (!symbol || !Array.isArray(candles) || candles.length < 20) {
      return NextResponse.json({ error: 'symbol and candles[20+] required' }, { status: 400 });
    }

    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_KEY'));
    const db = new TradingDB(supabase as unknown as import('@/trading/db/client').SupabaseClient);

    const alerter = new TelegramAlerter({
      botToken: getEnv('TELEGRAM_BOT_TOKEN'),
      chatId: getEnv('TELEGRAM_CHAT_ID'),
      dryRun: process.env.TELEGRAM_DRY_RUN === 'true',
    });

    const risk = new RiskManager({
      maxDrawdownPct: 0.10, dailyLossLimitPct: 0.02,
      maxPositionSizePct: 0.05, maxOpenPositions: 5, maxOrderQty: 500,
    });
    const engine = new ExecutionEngine(
      { slippagePct: 0.0002, latencyMs: 50, dryRun: process.env.TRADING_DRY_RUN !== 'false', defaultOrderType: 'MARKET' },
      risk,
    );
    const portfolio = new Portfolio(Number(process.env.INITIAL_CAPITAL ?? 500000));

    // Run all signal generators
    const signals = [
      momentumSignal(symbol, candles),
      meanReversionSignal(symbol, candles),
      breakoutSignal(symbol, candles),
    ].filter(Boolean) as NonNullable<ReturnType<typeof momentumSignal>>[];

    const results = await Promise.all(
      signals.map(async (signal) => {
        await db.saveSignal(signal);
        alerter.signal(signal);
        const snap = portfolio.snapshot();
        const result = await engine.execute(signal, snap);
        await db.saveOrder(result.order);
        alerter.order(result.order);
        if (result.fill) {
          portfolio.applyFill(result.order, result.fill);
          await db.saveSnapshot(portfolio.snapshot());
        }
        if (result.blocked) alerter.risk('BLOCKED', result.blocked);
        return { signalId: signal.id, decision: result.order.status, blocked: result.blocked };
      })
    );

    return NextResponse.json({ symbol, signals: results });
  } catch (err) {
    console.error('[/api/trading/signal]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
