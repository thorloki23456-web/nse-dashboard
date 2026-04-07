'use client';

import type { OptionStrike } from '@/lib/types';
import { computeEntryDecision, scanAllStrategies, type EntryDecision } from '@/lib/entry-engine';
import { deriveSignalMetrics } from '@/lib/analytics';
import { calculatePCR, calculateMaxPain } from '@/lib/max-pain';

interface EntryDecisionPanelProps {
  data: OptionStrike[];
  underlyingValue: number;
  symbol: string;
  expiryDate: string;
}

const decisionStyle: Record<EntryDecision, string> = {
  STRONG_ENTER: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300',
  ENTER:        'bg-green-500/15 border-green-500/40 text-green-400',
  CAUTION:      'bg-yellow-500/15 border-yellow-500/40 text-yellow-400',
  WAIT:         'bg-amber-500/15 border-amber-500/40 text-amber-400',
  SKIP:         'bg-red-500/15 border-red-500/40 text-red-400',
};

const scoreColor = (s: number) =>
  s >= 85 ? 'text-emerald-300' :
  s >= 73 ? 'text-green-400' :
  s >= 55 ? 'text-yellow-400' :
  s >= 45 ? 'text-amber-400' : 'text-red-400';

const confluenceStyle = { high: 'text-green-400', medium: 'text-amber-400', low: 'text-red-400' } as const;

export default function EntryDecisionPanel({ data, underlyingValue, symbol, expiryDate }: EntryDecisionPanelProps) {
  if (!data || data.length === 0 || !symbol || !expiryDate) return null;

  const chain = { data, underlyingValue, expiryDate } as unknown as import('@/lib/types').OptionChain;
  const metrics = deriveSignalMetrics(chain);
  const pcr = calculatePCR(chain);
  const { maxPainStrike } = calculateMaxPain(chain);

  const baseInput = {
    symbol,
    metrics,
    context: { pcr, maxPainDistance: Math.abs(underlyingValue - maxPainStrike), netDelta: metrics.dex / 100, underlyingPrice: underlyingValue },
  };

  const result = computeEntryDecision(baseInput);
  const scanResults = scanAllStrategies(baseInput);

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Entry Decision Engine</h2>
          <p className="text-xs text-zinc-500 mt-0.5">3-layer scoring: OI structure · Greeks · LTP/Flow</p>
        </div>
        <div className={`rounded-full border px-4 py-1.5 text-sm font-bold ${decisionStyle[result.decision]}`}>
          {result.decision.replace('_', ' ')}
        </div>
      </div>

      {/* Score grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Score</div>
          <div className={`mt-1 text-3xl font-black ${scoreColor(result.score)}`}>{result.score}</div>
          <div className="text-xs text-zinc-500 mt-1">/ 100</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Confluence</div>
          <div className={`mt-1 text-2xl font-black capitalize ${confluenceStyle[result.confluence]}`}>{result.confluence}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">OI Layer</div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{result.layerScores.oi}<span className="text-xs text-zinc-500">/70</span></div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Greeks</div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{result.layerScores.greeks}<span className="text-xs text-zinc-500">/65</span></div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Flow</div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{result.layerScores.ltp}<span className="text-xs text-zinc-500">/65</span></div>
        </div>
      </div>

      {/* Option type + delta */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-2">
          <span className="text-zinc-500">Suggested: </span>
          <span className={`font-bold ${result.optionType === 'CE' ? 'text-green-400' : result.optionType === 'PE' ? 'text-red-400' : 'text-zinc-400'}`}>
            {result.optionType}
          </span>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-2">
          <span className="text-zinc-500">Target Δ: </span>
          <span className="font-mono text-zinc-200">{result.suggestedDelta.toFixed(2)}</span>
        </div>
      </div>

      {/* Stop logic */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Stop Logic</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          <div><span className="text-zinc-500">Hard Stop: </span><span className="font-mono text-red-400">{result.stopLogic.hardStop != null ? result.stopLogic.hardStop.toFixed(0) : 'N/A'}</span></div>
          <div><span className="text-zinc-500">Trail: </span><span className="text-zinc-300">{result.stopLogic.trailStop}</span></div>
          <div><span className="text-zinc-500">Exit: </span><span className="text-zinc-300">{result.stopLogic.exitTrigger}</span></div>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w) => (
            <div key={w} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-300">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {/* Strategy scanner */}
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Strategy Scanner</div>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {scanResults.map((r) => (
                <tr key={r.strategy} className="border-b border-zinc-900/70 hover:bg-zinc-800/20">
                  <td className="px-3 py-2 font-mono text-zinc-300">{r.strategy}</td>
                  <td className={`px-3 py-2 font-bold ${scoreColor(r.score)}`}>{r.score}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${decisionStyle[r.decision]}`}>
                      {r.decision.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{r.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
