'use client';

import type { OptionStrike } from '@/lib/types';
import { calculateGEXByStrike } from '@/lib/max-pain';

interface GEXChartProps {
  data: OptionStrike[];
  underlyingValue: number;
  strikesAroundATM?: number;
}

const BAR_MAX_WIDTH = 200;

export default function GEXChart({ data, underlyingValue, strikesAroundATM = 10 }: GEXChartProps) {
  if (!data || data.length === 0) return null;

  const chain = { data, underlyingValue } as unknown as import('@/lib/types').OptionChain;
  const gexData = calculateGEXByStrike(chain);

  const sorted = [...gexData].sort((a, b) => a.strike - b.strike);
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

  const maxAbs = Math.max(...slice.map((r) => Math.abs(r.gex)), 0.01);

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <h2 className="text-xl font-bold text-zinc-100 mb-1">Gamma Exposure (GEX)</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Positive GEX = dealer long gamma (stabilising). Negative GEX = dealer short gamma (amplifying).
      </p>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 480 }}>
          {/* Centre axis */}
          <div className="relative">
            {slice.map((row) => {
              const isATM = Math.abs(row.strike - underlyingValue) < 50;
              const barW = Math.round((Math.abs(row.gex) / maxAbs) * BAR_MAX_WIDTH);
              const isPos = row.gex >= 0;
              return (
                <div key={row.strike} className="flex items-center gap-2 mb-1">
                  <div
                    className={`w-16 text-right text-xs font-mono shrink-0 ${isATM ? 'text-yellow-400 font-bold' : 'text-zinc-400'}`}
                  >
                    {row.strike}
                  </div>

                  {/* Negative side (left) */}
                  <div className="flex justify-end" style={{ width: BAR_MAX_WIDTH }}>
                    {!isPos && (
                      <div
                        className="rounded-sm bg-red-500/75"
                        style={{ width: barW, height: 14 }}
                        title={`GEX: ${row.gex}`}
                      />
                    )}
                  </div>

                  {/* Centre line */}
                  <div className="w-px h-4 bg-zinc-600 shrink-0" />

                  {/* Positive side (right) */}
                  <div style={{ width: BAR_MAX_WIDTH }}>
                    {isPos && (
                      <div
                        className="rounded-sm bg-green-500/75"
                        style={{ width: barW, height: 14 }}
                        title={`GEX: ${row.gex}`}
                      />
                    )}
                  </div>

                  <div className={`text-xs font-mono shrink-0 w-14 ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                    {isPos ? '+' : ''}{row.gex.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Axis labels */}
          <div className="flex mt-2 text-xs text-zinc-600">
            <div style={{ width: 64 + BAR_MAX_WIDTH + 1 }} className="text-right pr-2">← Negative</div>
            <div style={{ width: BAR_MAX_WIDTH }} className="pl-2">Positive →</div>
          </div>
        </div>
      </div>
    </div>
  );
}
