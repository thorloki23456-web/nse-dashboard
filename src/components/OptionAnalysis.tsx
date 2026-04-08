'use client';

import type { OptionStrike } from '@/lib/types';

type Analysis = 'Long Buildup' | 'Short Buildup' | 'Short Covering' | 'Long Liquidation' | 'No Activity';
type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface StrikeAnalysis {
  strike: number;
  ceAnalysis: Analysis;
  ceTrend: Trend;
  peAnalysis: Analysis;
  peTrend: Trend;
  cePriceChange: number;
  ceOiChange: number;
  pePriceChange: number;
  peOiChange: number;
}

function getAnalysis(priceChange: number, oiChange: number): { analysis: Analysis; trend: Trend } {
  if (priceChange > 0 && oiChange > 0) return { analysis: 'Long Buildup', trend: 'BULLISH' };
  if (priceChange < 0 && oiChange > 0) return { analysis: 'Short Buildup', trend: 'BEARISH' };
  if (priceChange > 0 && oiChange < 0) return { analysis: 'Short Covering', trend: 'BULLISH' };
  if (priceChange < 0 && oiChange < 0) return { analysis: 'Long Liquidation', trend: 'BEARISH' };
  return { analysis: 'No Activity', trend: 'NEUTRAL' };
}

const analysisColors: Record<Analysis, string> = {
  'Long Buildup': 'text-green-400',
  'Short Covering': 'text-emerald-400',
  'Short Buildup': 'text-red-400',
  'Long Liquidation': 'text-orange-400',
  'No Activity': 'text-zinc-500',
};

const trendBadge: Record<Trend, { bg: string; text: string }> = {
  BULLISH: { bg: 'bg-green-500/15 border-green-500/30', text: 'text-green-400' },
  BEARISH: { bg: 'bg-red-500/15 border-red-500/30', text: 'text-red-400' },
  NEUTRAL: { bg: 'bg-zinc-500/15 border-zinc-500/30', text: 'text-zinc-400' },
};

interface OptionAnalysisProps {
  data: OptionStrike[];
}

export default function OptionAnalysis({ data }: OptionAnalysisProps) {
  if (!data || data.length === 0) return null;

  const analyses: StrikeAnalysis[] = data
    .map((item) => {
      const cePriceChange = item.CE?.change ?? 0;
      const ceOiChange = item.CE?.changeinOpenInterest ?? 0;
      const pePriceChange = item.PE?.change ?? 0;
      const peOiChange = item.PE?.changeinOpenInterest ?? 0;

      const ce = getAnalysis(cePriceChange, ceOiChange);
      const pe = getAnalysis(pePriceChange, peOiChange);

      return {
        strike: item.strikePrice,
        ceAnalysis: ce.analysis,
        ceTrend: ce.trend,
        peAnalysis: pe.analysis,
        peTrend: pe.trend,
        cePriceChange,
        ceOiChange,
        pePriceChange,
        peOiChange,
      };
    })
    .filter((a) => a.ceAnalysis !== 'No Activity' || a.peAnalysis !== 'No Activity')
    .sort((a, b) => a.strike - b.strike);

  // Summary counts
  const ceCounts = { 'Long Buildup': 0, 'Short Buildup': 0, 'Short Covering': 0, 'Long Liquidation': 0 };
  const peCounts = { 'Long Buildup': 0, 'Short Buildup': 0, 'Short Covering': 0, 'Long Liquidation': 0 };
  analyses.forEach((a) => {
    if (a.ceAnalysis !== 'No Activity') ceCounts[a.ceAnalysis]++;
    if (a.peAnalysis !== 'No Activity') peCounts[a.peAnalysis]++;
  });

  const bullishSignals =
    ceCounts['Long Buildup'] + ceCounts['Short Covering'] +
    peCounts['Long Buildup'] + peCounts['Short Covering'];
  const bearishSignals =
    ceCounts['Short Buildup'] + ceCounts['Long Liquidation'] +
    peCounts['Short Buildup'] + peCounts['Long Liquidation'];

  const overallTrend: Trend = bullishSignals > bearishSignals ? 'BULLISH' : bearishSignals > bullishSignals ? 'BEARISH' : 'NEUTRAL';

  return (
    <div className="mt-8 space-y-6">
      {/* Analysis Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-100">Option Analysis</h2>
        <div className={`px-4 py-1.5 rounded-full border text-sm font-bold ${trendBadge[overallTrend].bg} ${trendBadge[overallTrend].text}`}>
          Overall: {overallTrend}
        </div>
      </div>

      {/* Reference Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Analysis Rules */}
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Analysis Rules</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800/50">
                <th className="py-2 text-left px-2">Price Chg</th>
                <th className="py-2 text-left px-2">OI Chg</th>
                <th className="py-2 text-left px-2">Analysis</th>
                <th className="py-2 text-left px-2">Trend</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              <tr className="border-b border-zinc-800/30">
                <td className="py-2 px-2 text-green-400">Positive ↑</td>
                <td className="py-2 px-2 text-green-400">Positive ↑</td>
                <td className="py-2 px-2 font-medium text-green-400">Long Buildup</td>
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold">BULLISH</span></td>
              </tr>
              <tr className="border-b border-zinc-800/30">
                <td className="py-2 px-2 text-red-400">Negative ↓</td>
                <td className="py-2 px-2 text-green-400">Positive ↑</td>
                <td className="py-2 px-2 font-medium text-red-400">Short Buildup</td>
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">BEARISH</span></td>
              </tr>
              <tr className="border-b border-zinc-800/30">
                <td className="py-2 px-2 text-green-400">Positive ↑</td>
                <td className="py-2 px-2 text-red-400">Negative ↓</td>
                <td className="py-2 px-2 font-medium text-emerald-400">Short Covering</td>
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold">BULLISH</span></td>
              </tr>
              <tr>
                <td className="py-2 px-2 text-red-400">Negative ↓</td>
                <td className="py-2 px-2 text-red-400">Negative ↓</td>
                <td className="py-2 px-2 font-medium text-orange-400">Long Liquidation</td>
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">BEARISH</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Action Plan */}
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Action Plan</h3>
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800/50">
                <th className="py-2 text-left px-2">Trend</th>
                <th className="py-2 text-left px-2">Call Option</th>
                <th className="py-2 text-left px-2">Put Option</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              <tr className="border-b border-zinc-800/30">
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold">BULLISH</span></td>
                <td className="py-2 px-2 font-bold text-green-400">BUY</td>
                <td className="py-2 px-2 font-bold text-red-400">SELL</td>
              </tr>
              <tr>
                <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">BEARISH</span></td>
                <td className="py-2 px-2 font-bold text-red-400">SELL</td>
                <td className="py-2 px-2 font-bold text-green-400">BUY</td>
              </tr>
            </tbody>
          </table>

          {/* Signal Summary */}
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3 mt-4">Signal Summary</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{bullishSignals}</div>
              <div className="text-xs text-zinc-400 mt-1">Bullish Signals</div>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{bearishSignals}</div>
              <div className="text-xs text-zinc-400 mt-1">Bearish Signals</div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Strike Analysis Table */}
      {analyses.length > 0 && (
        <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700/50">
                  <th colSpan={3} className="px-3 py-3 text-center text-red-400 font-semibold bg-red-500/5 text-xs uppercase tracking-wider">
                    Call Analysis
                  </th>
                  <th className="px-3 py-3 text-center bg-zinc-800/60 font-bold text-zinc-200">Strike</th>
                  <th colSpan={3} className="px-3 py-3 text-center text-green-400 font-semibold bg-green-500/5 text-xs uppercase tracking-wider">
                    Put Analysis
                  </th>
                </tr>
                <tr className="border-b border-zinc-700/50 text-zinc-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-right bg-red-500/5">Price Chg</th>
                  <th className="px-3 py-2 text-right bg-red-500/5">OI Chg</th>
                  <th className="px-3 py-2 text-right bg-red-500/5">Analysis</th>
                  <th className="px-3 py-2 text-center bg-zinc-800/60"></th>
                  <th className="px-3 py-2 text-left bg-green-500/5">Analysis</th>
                  <th className="px-3 py-2 text-left bg-green-500/5">OI Chg</th>
                  <th className="px-3 py-2 text-left bg-green-500/5">Price Chg</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((a) => (
                  <tr key={a.strike} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-3 py-2 text-right font-mono bg-red-500/[0.02]">
                      <span className={a.cePriceChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {a.cePriceChange >= 0 ? '+' : ''}{a.cePriceChange.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono bg-red-500/[0.02]">
                      <span className={a.ceOiChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {a.ceOiChange >= 0 ? '+' : ''}{a.ceOiChange.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right font-medium bg-red-500/[0.02] ${analysisColors[a.ceAnalysis]}`}>
                      {a.ceAnalysis}
                    </td>
                    <td className="px-3 py-2 text-center font-bold text-zinc-100 bg-zinc-800/60 text-base">
                      {a.strike}
                    </td>
                    <td className={`px-3 py-2 text-left font-medium bg-green-500/[0.02] ${analysisColors[a.peAnalysis]}`}>
                      {a.peAnalysis}
                    </td>
                    <td className="px-3 py-2 text-left font-mono bg-green-500/[0.02]">
                      <span className={a.peOiChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {a.peOiChange >= 0 ? '+' : ''}{a.peOiChange.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-left font-mono bg-green-500/[0.02]">
                      <span className={a.pePriceChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {a.pePriceChange >= 0 ? '+' : ''}{a.pePriceChange.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
