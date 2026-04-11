'use client';

import type { SignalDirection } from '@/lib/termStructure.types';
import type { AnalyticsSnapshot, ConfluenceRegime } from '@/lib/types';

interface ConfluencePanelProps {
  snapshot: AnalyticsSnapshot | null;
  symbol: string;
  expiryDate: string;
  loading?: boolean;
  termStructure?: {
    currentExpiryDate: string | null;
    nextExpiryDate: string | null;
    error: string | null;
  } | null;
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

const directionStyles: Record<SignalDirection, string> = {
  BULLISH: 'bg-green-500/15 border-green-500/30 text-green-400',
  BEARISH: 'bg-red-500/15 border-red-500/30 text-red-400',
  NEUTRAL: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',
  EXPIRY_PIN: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
};

function formatMetric(value: number, decimals = 2) {
  return value.toFixed(decimals);
}

export default function ConfluencePanel({
  snapshot,
  symbol,
  expiryDate,
  loading = false,
  termStructure = null,
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

  const { confluence, metrics, termStructure: termStructureResult } = snapshot;

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

      <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Weekly Term Structure
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {termStructure?.currentExpiryDate && termStructure?.nextExpiryDate
                ? `${termStructure.currentExpiryDate} vs ${termStructure.nextExpiryDate}`
                : 'Comparative overlay for current-week versus next-week positioning'}
            </p>
          </div>
          {termStructureResult ? (
            <div
              className={`rounded-full border px-4 py-1.5 text-xs font-bold ${directionStyles[termStructureResult.recommendation.direction]}`}
            >
              {termStructureResult.recommendation.action}
            </div>
          ) : (
            <div className="rounded-full border border-zinc-700/50 bg-zinc-800/50 px-4 py-1.5 text-xs font-semibold text-zinc-300">
              Informational overlay
            </div>
          )}
        </div>

        {termStructureResult ? (
          <div className="space-y-5 px-4 py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <TermStructureMetricCard
                label="Confluence"
                value={`${termStructureResult.confluence.confluenceScore}/100`}
              />
              <TermStructureMetricCard
                label="Direction"
                value={termStructureResult.recommendation.direction}
                tone={termStructureResult.recommendation.direction}
              />
              <TermStructureMetricCard
                label="Strength"
                value={termStructureResult.recommendation.strength}
              />
              <TermStructureMetricCard
                label="Suggested Expiry"
                value={termStructureResult.recommendation.suggestedExpiry}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <MetricCard
                label="ATM Term Spread"
                value={termStructureResult.features.atmTermSpread}
              />
              <MetricCard
                label="Put Skew Transfer"
                value={termStructureResult.features.putSkewTransfer}
              />
              <MetricCard label="OI Roll Ratio" value={termStructureResult.features.oiRollRatio} />
              <MetricCard label="Wall Shift" value={termStructureResult.features.wallShift} />
              <MetricCard
                label="Pin vs Breakout"
                value={termStructureResult.features.pinVsBreakout}
              />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-zinc-500">
                    Recommendation
                  </div>
                  <div className="mt-1 text-lg font-bold text-zinc-100">
                    {termStructureResult.recommendation.action}
                  </div>
                </div>
                {typeof termStructureResult.recommendation.suggestedStrike === 'number' ? (
                  <div className="text-sm text-zinc-400">
                    Strike: {formatMetric(termStructureResult.recommendation.suggestedStrike, 0)}
                  </div>
                ) : null}
              </div>

              <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                {termStructureResult.recommendation.rationale.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>

              <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-400">
                Risk Note: {termStructureResult.recommendation.riskNote}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                    <th className="px-3 py-2">Feature</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Strength</th>
                    <th className="px-3 py-2">Raw Value</th>
                    <th className="px-3 py-2">Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {termStructureResult.featureSignals.map((signal) => (
                    <tr key={signal.feature} className="border-b border-zinc-900/70 text-zinc-300">
                      <td className="px-3 py-2 font-medium text-zinc-100">{signal.feature}</td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          signal.direction === 'BULLISH'
                            ? 'text-green-400'
                            : signal.direction === 'BEARISH'
                              ? 'text-red-400'
                              : signal.direction === 'EXPIRY_PIN'
                                ? 'text-amber-300'
                                : 'text-zinc-400'
                        }`}
                      >
                        {signal.direction}
                      </td>
                      <td className="px-3 py-2">{signal.strength}</td>
                      <td className="px-3 py-2 font-mono">{formatMetric(signal.rawValue)}</td>
                      <td className="px-3 py-2 text-zinc-400">{signal.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 text-sm text-zinc-400">
            {termStructure?.error
              ? `Term structure unavailable: ${termStructure.error}`
              : 'Waiting for current-week and next-week option chains to build the comparative expiry overlay.'}
          </div>
        )}
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

function TermStructureMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: SignalDirection;
}) {
  const toneClass = tone ? directionStyles[tone] : 'border-zinc-800 bg-zinc-950/70 text-zinc-100';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
