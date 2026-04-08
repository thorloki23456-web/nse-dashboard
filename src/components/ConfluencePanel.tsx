'use client';

import type { AnalyticsSnapshot, ConfluenceRegime } from '@/lib/types';

interface ConfluencePanelProps {
  snapshot: AnalyticsSnapshot | null;
  symbol: string;
  expiryDate: string;
  loading?: boolean;
}

const regimeStyles: Record<ConfluenceRegime, string> = {
  LONG: 'bg-green-500/15 border-green-500/30 text-green-400',
  SHORT: 'bg-red-500/15 border-red-500/30 text-red-400',
  NEUTRAL: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',
};

const biasStyles = {
  bullish: 'text-green-400',
  bearish: 'text-red-400',
  neutral: 'text-zinc-400',
} as const;

function formatMetric(value: number, decimals = 2) {
  return value.toFixed(decimals);
}

export default function ConfluencePanel({
  snapshot,
  symbol,
  expiryDate,
  loading = false,
}: ConfluencePanelProps) {
  if (!snapshot) {
    return (
      <section className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">Confluence Engine</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {symbol && expiryDate
                ? `${symbol} • ${expiryDate}`
                : 'Select symbol and expiry to activate the decision layer'}
            </p>
          </div>
          <div className="rounded-full border border-zinc-700/50 bg-zinc-800/50 px-4 py-1.5 text-sm font-semibold text-zinc-300">
            {loading ? 'Computing…' : 'Awaiting data'}
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">
          Live confluence output appears once the option chain has a symbol, expiry, and a valid spot price.
        </div>
      </section>
    );
  }

  const { confluence, metrics } = snapshot;

  return (
    <section className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Confluence Engine</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {symbol} • {expiryDate} • {confluence.rationale}
          </p>
        </div>
        <div className={`rounded-full border px-4 py-1.5 text-sm font-bold ${regimeStyles[confluence.regime]}`}>
          Regime: {confluence.regime}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Confidence</div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{formatMetric(confluence.confidence, 1)}%</div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full ${
                confluence.regime === 'LONG'
                  ? 'bg-green-500'
                  : confluence.regime === 'SHORT'
                    ? 'bg-red-500'
                    : 'bg-zinc-400'
              }`}
              style={{ width: `${confluence.confidence}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Bullish Score</div>
          <div className="mt-1 text-2xl font-black text-green-400">{formatMetric(confluence.bullishScore)}</div>
          <div className="mt-2 text-xs text-zinc-500">Weighted upside confluence.</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Bearish Score</div>
          <div className="mt-1 text-2xl font-black text-red-400">{formatMetric(confluence.bearishScore)}</div>
          <div className="mt-2 text-xs text-zinc-500">Weighted downside confluence.</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Net Score</div>
          <div
            className={`mt-1 text-2xl font-black ${
              confluence.netScore >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {confluence.netScore >= 0 ? '+' : ''}
            {formatMetric(confluence.netScore)}
          </div>
          <div className="mt-2 text-xs text-zinc-500">Threshold: {formatMetric(confluence.thresholdUsed)}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <MetricCard label="GEX" value={metrics.gex} />
        <MetricCard label="Gamma Flip %" value={metrics.gammaFlip} />
        <MetricCard label="DEX" value={metrics.dex} />
        <MetricCard label="IV Skew" value={metrics.ivSkew} />
        <MetricCard label="OI Imbalance" value={metrics.oiImbalance} />
        <MetricCard label="UVR" value={metrics.uvr} decimals={3} />
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Signal Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2">Signal</th>
                <th className="px-4 py-2">Bias</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Normalized</th>
                <th className="px-4 py-2">Weight</th>
                <th className="px-4 py-2">Contribution</th>
                <th className="px-4 py-2">Commentary</th>
              </tr>
            </thead>
            <tbody>
              {confluence.breakdown.items.map((item) => (
                <tr key={item.name} className="border-b border-zinc-900/70 text-zinc-300">
                  <td className="px-4 py-2 font-medium text-zinc-100">{item.name}</td>
                  <td className={`px-4 py-2 font-semibold ${biasStyles[item.bias === 'LONG' ? 'bullish' : item.bias === 'SHORT' ? 'bearish' : 'neutral']}`}>
                    {item.bias}
                  </td>
                  <td className="px-4 py-2 font-mono">{formatMetric(item.value)}</td>
                  <td className="px-4 py-2 font-mono">{formatMetric(item.normalized)}</td>
                  <td className="px-4 py-2 font-mono">{formatMetric(item.weight, 3)}</td>
                  <td className="px-4 py-2 font-mono">{formatMetric(item.contribution)}</td>
                  <td className="px-4 py-2 text-zinc-400">{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  decimals = 2,
}: {
  label: string;
  value: number;
  decimals?: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-zinc-100">{formatMetric(value, decimals)}</div>
    </div>
  );
}
