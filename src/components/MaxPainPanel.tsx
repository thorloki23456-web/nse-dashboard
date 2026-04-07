'use client';

import type { OptionStrike } from '@/lib/types';
import { calculateMaxPain, calculatePCR } from '@/lib/max-pain';

interface MaxPainPanelProps {
  data: OptionStrike[];
  underlyingValue: number;
}

export default function MaxPainPanel({ data, underlyingValue }: MaxPainPanelProps) {
  if (!data || data.length === 0) return null;

  const chain = { data, underlyingValue } as unknown as import('@/lib/types').OptionChain;
  const { maxPainStrike, payoutByStrike } = calculateMaxPain(chain);
  const pcr = calculatePCR(chain);

  const distancePct =
    underlyingValue > 0
      ? (((underlyingValue - maxPainStrike) / underlyingValue) * 100).toFixed(2)
      : '0.00';

  const pcrLabel =
    pcr < 0.7 ? 'Extremely Bullish' :
    pcr < 0.9 ? 'Bullish' :
    pcr < 1.1 ? 'Neutral' :
    pcr < 1.3 ? 'Bearish' : 'Extremely Bearish';

  const pcrColor =
    pcr < 0.9 ? 'text-green-400' :
    pcr > 1.1 ? 'text-red-400' : 'text-zinc-300';

  // Top 5 strikes by payout for mini chart
  const top5 = [...payoutByStrike]
    .sort((a, b) => a.totalPayout - b.totalPayout)
    .slice(0, 5);

  const maxPayout = Math.max(...payoutByStrike.map((p) => p.totalPayout), 1);

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <h2 className="text-xl font-bold text-zinc-100 mb-1">Max Pain &amp; PCR</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Max Pain = strike where option buyers lose the most. PCR = Put/Call OI ratio.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* Max Pain */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Max Pain Strike</div>
          <div className="mt-1 text-2xl font-black text-yellow-400">{maxPainStrike.toLocaleString('en-IN')}</div>
          <div className="mt-1 text-xs text-zinc-400">
            Spot is <span className={Number(distancePct) > 0 ? 'text-green-400' : 'text-red-400'}>
              {Number(distancePct) > 0 ? '+' : ''}{distancePct}%
            </span> from max pain
          </div>
        </div>

        {/* PCR */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Put-Call Ratio (OI)</div>
          <div className={`mt-1 text-2xl font-black ${pcrColor}`}>{pcr.toFixed(2)}</div>
          <div className="mt-1 text-xs text-zinc-400">{pcrLabel}</div>
        </div>

        {/* Spot vs Max Pain */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Spot Price</div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{underlyingValue.toLocaleString('en-IN')}</div>
          <div className="mt-1 text-xs text-zinc-400">
            Max pain gravity: {Math.abs(Number(distancePct)) < 0.5 ? 'Strong pin' : Math.abs(Number(distancePct)) < 1.5 ? 'Moderate' : 'Weak'}
          </div>
        </div>
      </div>

      {/* Mini payout chart — lowest payout = max pain */}
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Lowest Payout Strikes (Max Pain Candidates)</div>
        <div className="space-y-1">
          {top5.map((p) => (
            <div key={p.strike} className="flex items-center gap-2">
              <div className={`w-20 text-right text-xs font-mono shrink-0 ${p.strike === maxPainStrike ? 'text-yellow-400 font-bold' : 'text-zinc-400'}`}>
                {p.strike}
              </div>
              <div
                className={`rounded-sm h-3 ${p.strike === maxPainStrike ? 'bg-yellow-400/70' : 'bg-zinc-600/60'}`}
                style={{ width: Math.round((p.totalPayout / maxPayout) * 200) }}
              />
              <div className="text-xs text-zinc-500 font-mono">
                {(p.totalPayout / 1e7).toFixed(1)}Cr
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
