'use client';

import type { OptionStrike } from '@/lib/types';
import { calculateIVSkewByStrike } from '@/lib/max-pain';

interface IVSkewChartProps {
  data: OptionStrike[];
  underlyingValue: number;
  strikesAroundATM?: number;
}

const BAR_HEIGHT = 18;
const CHART_WIDTH = 260;

export default function IVSkewChart({ data, underlyingValue, strikesAroundATM = 10 }: IVSkewChartProps) {
  if (!data || data.length === 0) return null;

  const chain = { data, underlyingValue } as unknown as import('@/lib/types').OptionChain;
  const skewData = calculateIVSkewByStrike(chain);

  // Filter to ATM ± N strikes
  const sorted = [...skewData].sort((a, b) => a.strike - b.strike);
  const atmIdx = sorted.reduce(
    (best, cur, i) =>
      Math.abs(cur.strike - underlyingValue) < Math.abs(sorted[best].strike - underlyingValue) ? i : best,
    0
  );
  const slice = sorted.slice(
    Math.max(0, atmIdx - strikesAroundATM),
    atmIdx + strikesAroundATM + 1
  );

  if (slice.length === 0) return null;

  const maxIV = Math.max(...slice.flatMap((r) => [r.callIV, r.putIV]), 1);

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <h2 className="text-xl font-bold text-zinc-100 mb-1">IV Skew</h2>
      <p className="text-xs text-zinc-500 mb-4">Call IV vs Put IV by strike — skew shows relative demand</p>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 520 }}>
          {/* Legend */}
          <div className="flex gap-4 mb-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-blue-500" /> Call IV</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-orange-400" /> Put IV</span>
          </div>

          {slice.map((row) => {
            const isATM = Math.abs(row.strike - underlyingValue) < 50;
            const callW = Math.round((row.callIV / maxIV) * CHART_WIDTH);
            const putW = Math.round((row.putIV / maxIV) * CHART_WIDTH);
            return (
              <div key={row.strike} className="flex items-center gap-2 mb-1">
                {/* Strike label */}
                <div
                  className={`w-16 text-right text-xs font-mono shrink-0 ${isATM ? 'text-yellow-400 font-bold' : 'text-zinc-400'}`}
                >
                  {row.strike}
                </div>

                {/* Bars */}
                <div className="flex flex-col gap-0.5">
                  <div
                    className="rounded-sm bg-blue-500/80"
                    style={{ width: callW, height: BAR_HEIGHT / 2 }}
                    title={`Call IV: ${row.callIV.toFixed(1)}%`}
                  />
                  <div
                    className="rounded-sm bg-orange-400/80"
                    style={{ width: putW, height: BAR_HEIGHT / 2 }}
                    title={`Put IV: ${row.putIV.toFixed(1)}%`}
                  />
                </div>

                {/* Skew value */}
                <div className={`text-xs font-mono shrink-0 ${row.skew > 0 ? 'text-blue-400' : row.skew < 0 ? 'text-orange-400' : 'text-zinc-500'}`}>
                  {row.skew > 0 ? '+' : ''}{row.skew.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
