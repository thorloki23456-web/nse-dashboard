'use client';

import type { ConfluenceResult } from '@/lib/types';

interface ConfluencePanelProps {
  confluence: ConfluenceResult | null;
  symbol: string;
  expiryDate: string;
  loading?: boolean;
}

type RegimeView = 'LONG' | 'SHORT' | 'NEUTRAL';

type BreakdownRow = {
  name: string;
  direction: RegimeView;
  value: string;
  score: number | null;
  note: string;
};

function normalizeRegime(value: unknown): RegimeView {
  if (typeof value !== 'string') return 'NEUTRAL';
  const upper = value.toUpperCase();

  if (upper.includes('LONG') || upper.includes('BULL')) return 'LONG';
  if (upper.includes('SHORT') || upper.includes('BEAR')) return 'SHORT';
  return 'NEUTRAL';
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function normalizeScore(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function extractBreakdown(confluence: ConfluenceResult | null): BreakdownRow[] {
  if (!confluence || typeof confluence !== 'object') return [];

  const source = confluence as unknown as Record<string, unknown>;
  const breakdown = source.breakdown;
  if (!Array.isArray(breakdown)) return [];

  const rows: BreakdownRow[] = [];
  for (const item of breakdown) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;

    const nameSource = row.name ?? row.signal ?? row.factor ?? row.key ?? 'Signal';
    const valueSource = row.value ?? row.metric ?? row.raw ?? '-';
    const directionSource = row.direction ?? row.bias ?? row.regime ?? 'NEUTRAL';
    const noteSource = row.note ?? row.reason ?? row.description ?? '';

    const scoreSource = row.score ?? row.normalized ?? row.contribution;
    const score = typeof scoreSource === 'number' && !Number.isNaN(scoreSource)
      ? Math.round(scoreSource * 100) / 100
      : null;

    rows.push({
      name: String(nameSource),
      direction: normalizeRegime(directionSource),
      value: String(valueSource),
      score,
      note: String(noteSource),
    });
  }

  return rows;
}

function confidenceBarClass(confidence: number) {
  if (confidence >= 75) return 'from-green-500 to-emerald-400';
  if (confidence >= 50) return 'from-amber-500 to-orange-400';
  return 'from-zinc-500 to-zinc-400';
}

const regimeStyle: Record<RegimeView, string> = {
  LONG: 'bg-green-500/15 border-green-500/30 text-green-400',
  SHORT: 'bg-red-500/15 border-red-500/30 text-red-400',
  NEUTRAL: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',
};

const directionStyle: Record<RegimeView, string> = {
  LONG: 'text-green-400',
  SHORT: 'text-red-400',
  NEUTRAL: 'text-zinc-400',
};

export default function ConfluencePanel({
  confluence,
  symbol,
  expiryDate,
  loading = false,
}: ConfluencePanelProps) {
  const regime = normalizeRegime(confluence?.regime);
  const confidence = normalizeConfidence(confluence?.confidence);
  const bullishScore = normalizeScore(confluence?.bullishScore);
  const bearishScore = normalizeScore(confluence?.bearishScore);
  const breakdown = extractBreakdown(confluence);

  const hasData = Boolean(confluence);

  return (
    <section className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Confluence Engine</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {symbol && expiryDate
              ? `${symbol} • ${expiryDate}`
              : 'Select symbol and expiry to activate decision engine'}
          </p>
        </div>
        <div className={`rounded-full border px-4 py-1.5 text-sm font-bold ${regimeStyle[regime]}`}>
          Regime: {regime}
        </div>
      </div>

      {loading && !hasData ? (
        <div className="mt-4 rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-sm text-blue-300">
          Computing live signal confluence...
        </div>
      ) : null}

      {!hasData && !loading ? (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">
          Waiting for live option-chain snapshots to produce a confluence decision.
        </div>
      ) : null}

      {hasData ? (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Confidence</div>
              <div className="mt-1 text-2xl font-black text-zinc-100">{confidence.toFixed(1)}%</div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${confidenceBarClass(confidence)}`}
                  style={{ width: `${confidence}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Bullish Score</div>
              <div className="mt-1 text-2xl font-black text-green-400">{bullishScore.toFixed(1)}</div>
              <p className="mt-2 text-xs text-zinc-500">Buy-pressure composite from OI, Greeks, and flow.</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Bearish Score</div>
              <div className="mt-1 text-2xl font-black text-red-400">{bearishScore.toFixed(1)}</div>
              <p className="mt-2 text-xs text-zinc-500">Sell-pressure composite from structural and tape signals.</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-zinc-800">
            <div className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Signal Breakdown</h3>
            </div>
            {breakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-4 py-2">Signal</th>
                      <th className="px-4 py-2">Direction</th>
                      <th className="px-4 py-2">Value</th>
                      <th className="px-4 py-2">Score</th>
                      <th className="px-4 py-2">Commentary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((row) => (
                      <tr key={row.name} className="border-b border-zinc-900/70 text-zinc-300">
                        <td className="px-4 py-2 font-medium text-zinc-200">{row.name}</td>
                        <td className={`px-4 py-2 font-semibold ${directionStyle[row.direction]}`}>{row.direction}</td>
                        <td className="px-4 py-2 font-mono">{row.value}</td>
                        <td className="px-4 py-2 font-mono">
                          {row.score === null ? '-' : row.score.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">{row.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-zinc-400">
                Breakdown details are unavailable for this snapshot.
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
