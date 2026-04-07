import { NextRequest, NextResponse } from 'next/server';
import { Backtester } from '@/trading/backtester/engine';
import { momentumSignal } from '@/trading/signals/generators';
import { TelegramAlerter } from '@/trading/alerts/telegram';
import type { Candle } from '@/trading/types';

const STRATEGY_MAP = {
  momentum: momentumSignal,
} as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      symbol: string;
      candles: Candle[];
      strategy?: keyof typeof STRATEGY_MAP;
      startTs?: number;
      endTs?: number;
      initialCapital?: number;
      seed?: number;
    };

    const { symbol, candles } = body;
    if (!symbol || !Array.isArray(candles) || candles.length < 30) {
      return NextResponse.json({ error: 'symbol and candles[30+] required' }, { status: 400 });
    }

    const strategyFn = STRATEGY_MAP[body.strategy ?? 'momentum'];
    const bt = new Backtester({
      startTs: body.startTs ?? candles[0].ts,
      endTs: body.endTs ?? candles.at(-1)!.ts,
      initialCapital: body.initialCapital ?? 500000,
      commissionPct: 0.0003,
      slippagePct: 0.0002,
      seed: body.seed ?? 42,
    });

    const result = bt.run(symbol, candles, strategyFn);

    // Optionally push metrics to Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const alerter = new TelegramAlerter({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        dryRun: process.env.TELEGRAM_DRY_RUN === 'true',
      });
      alerter.metrics(result.metrics);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/trading/backtest]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
