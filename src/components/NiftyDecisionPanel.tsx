'use client';

import { selectNiftyLongOnlyTrade } from '@/lib/strategies/intraday-nifty50';
import type { AnalyticsSnapshot } from '@/lib/types';

interface NiftyDecisionPanelProps {
  snapshot: AnalyticsSnapshot | null;
}

const actionStyles = {
  BUY_CE: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
  BUY_PE: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
  NO_TRADE: 'border-zinc-700/60 bg-zinc-800/50 text-zinc-300',
} as const;

export default function NiftyDecisionPanel({ snapshot }: NiftyDecisionPanelProps) {
  const decision = selectNiftyLongOnlyTrade(snapshot);

  if (!decision) {
    return null;
  }

  return (
    <section className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">NIFTY 50 Intraday Selector</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Long-only decision layer using confluence, spot trend, OI pressure, gamma regime, and flow confirmation.
          </p>
        </div>
        <div className={`rounded-full border px-4 py-1.5 text-sm font-bold ${actionStyles[decision.action]}`}>
          {decision.action === 'BUY_CE' ? 'BUY CE' : decision.action === 'BUY_PE' ? 'BUY PE' : 'NO TRADE'}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard label="Bias" value={decision.marketBias.toUpperCase()} />
        <MetricCard label="Confidence" value={`${decision.confidence}%`} />
        <MetricCard
          label="Conviction"
          value={`${decision.convictionScore > 0 ? '+' : ''}${decision.convictionScore}`}
        />
        <MetricCard
          label="Contract"
          value={
            decision.selectedContract
              ? `${decision.selectedContract.strike} ${decision.selectedContract.optionType}`
              : 'Stand aside'
          }
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Why This Action</div>
          {decision.reasons.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              {decision.reasons.map((reason) => (
                <li key={reason}>• {reason}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">No directional edge survived the selector gates.</p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Trade Levels</div>
          <div className="mt-3 space-y-2 text-sm text-zinc-300">
            <div>
              <span className="text-zinc-500">Underlying entry: </span>
              <span className="font-mono">
                {decision.entryWindow
                  ? `${decision.entryWindow.underlyingMin} – ${decision.entryWindow.underlyingMax}`
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Premium entry: </span>
              <span className="font-mono">
                {decision.entryWindow
                  ? `${decision.entryWindow.premiumMin} – ${decision.entryWindow.premiumMax}`
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Underlying stop / target: </span>
              <span className="font-mono">
                {decision.risk.stopUnderlying != null && decision.risk.targetUnderlying != null
                  ? `${decision.risk.stopUnderlying} / ${decision.risk.targetUnderlying}`
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Premium stop / target: </span>
              <span className="font-mono">
                {decision.risk.stopPremium != null && decision.risk.targetPremium != null
                  ? `${decision.risk.stopPremium} / ${decision.risk.targetPremium}`
                  : 'N/A'}
              </span>
            </div>
            {decision.selectedContract ? (
              <div>
                <span className="text-zinc-500">Delta / liquidity: </span>
                <span className="font-mono">
                  {decision.selectedContract.delta} / {decision.selectedContract.liquidityScore}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {decision.blockers.length > 0 ? (
        <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-xs uppercase tracking-wider text-amber-300">Blockers</div>
          <ul className="mt-3 space-y-2 text-sm text-amber-200">
            {decision.blockers.map((blocker) => (
              <li key={blocker}>• {blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-lg border border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Signal Contributions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2">Signal</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {decision.contributions.map((item) => (
                <tr key={item.label} className="border-b border-zinc-900/70 text-zinc-300">
                  <td className="px-4 py-2 font-medium text-zinc-100">{item.label}</td>
                  <td className={`px-4 py-2 font-mono ${item.score >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {item.score >= 0 ? '+' : ''}
                    {item.score}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{item.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-zinc-100">{value}</div>
    </div>
  );
}
