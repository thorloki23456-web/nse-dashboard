'use client';

import { useMemo } from 'react';

import type { OptionStrike } from '@/lib/types';

interface OIBarChartProps {
  data: OptionStrike[];
  strikesAroundATM?: number; // number of strikes above and below ATM to show
}

export default function OIBarChart({ data, strikesAroundATM = 10 }: OIBarChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Sort by strike price
    const sorted = [...data]
      .filter((d) => d.CE && d.PE && d.CE.openInterest > 0 && d.PE.openInterest > 0)
      .sort((a, b) => a.strikePrice - b.strikePrice);

    if (sorted.length === 0) return null;

    // Find ATM: strike where |CE LTP - PE LTP| is smallest
    let atmIndex = 0;
    let minDiff = Infinity;
    sorted.forEach((item, idx) => {
      const ceLTP = item.CE?.lastPrice || 0;
      const peLTP = item.PE?.lastPrice || 0;
      const diff = Math.abs(ceLTP - peLTP);
      if (diff < minDiff) {
        minDiff = diff;
        atmIndex = idx;
      }
    });

    const start = Math.max(0, atmIndex - strikesAroundATM);
    const end = Math.min(sorted.length, atmIndex + strikesAroundATM + 1);
    const sliced = sorted.slice(start, end);
    const atmStrike = sorted[atmIndex]?.strikePrice;

    // Find max OI for scaling
    let maxOI = 0;
    sliced.forEach((item) => {
      const ceOI = item.CE?.openInterest || 0;
      const peOI = item.PE?.openInterest || 0;
      maxOI = Math.max(maxOI, ceOI, peOI);
    });

    // Total Call OI and Put OI
    let totalCallOI = 0;
    let totalPutOI = 0;
    sliced.forEach((item) => {
      totalCallOI += item.CE?.openInterest || 0;
      totalPutOI += item.PE?.openInterest || 0;
    });

    // PCR (Put-Call Ratio)
    const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : '—';

    // Max Pain calculation
    let minLoss = Infinity;
    let maxPainStrike = 0;
    
    // Calculate Max Pain across all active strikes
    sorted.forEach((testItem) => {
      let totalLoss = 0;
      const X = testItem.strikePrice;
      
      sorted.forEach((item) => {
        const K = item.strikePrice;
        // Calls: intrinsic value if expired at X
        if (X > K) {
          totalLoss += (item.CE?.openInterest || 0) * (X - K);
        }
        // Puts: intrinsic value if expired at X
        if (X < K) {
          totalLoss += (item.PE?.openInterest || 0) * (K - X);
        }
      });
      
      if (totalLoss < minLoss) {
        minLoss = totalLoss;
        maxPainStrike = X;
      }
    });

    return { sliced, maxOI, atmStrike, totalCallOI, totalPutOI, pcr, maxPainStrike };
  }, [data, strikesAroundATM]);

  if (!chartData) return null;

  const { sliced, maxOI, atmStrike, totalCallOI, totalPutOI, pcr, maxPainStrike } = chartData;

  const formatOI = (val: number) => {
    if (val >= 10000000) return (val / 10000000).toFixed(1) + 'Cr';
    if (val >= 100000) return (val / 100000).toFixed(1) + 'L';
    if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
    return val.toString();
  };

  const getBarWidth = (oi: number) => {
    if (maxOI === 0) return '0%';
    return `${(oi / maxOI) * 100}%`;
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold text-zinc-100">
          OI Distribution
          <span className="text-sm font-normal text-zinc-500 ml-2">
            (±{strikesAroundATM} strikes around ATM {atmStrike})
          </span>
        </h2>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-emerald-500"></div>
            <span className="text-zinc-400">Call OI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-red-500"></div>
            <span className="text-zinc-400">Put OI</span>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">Total Call OI</div>
          <div className="text-lg font-bold text-emerald-400">{formatOI(totalCallOI)}</div>
        </div>
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">Total Put OI</div>
          <div className="text-lg font-bold text-red-400">{formatOI(totalPutOI)}</div>
        </div>
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">PCR (Put/Call)</div>
          <div className={`text-lg font-bold ${Number(pcr) > 1 ? 'text-green-400' : Number(pcr) < 0.7 ? 'text-red-400' : 'text-zinc-200'}`}>
            {pcr}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">ATM Strike</div>
          <div className="text-lg font-bold text-blue-400">{atmStrike}</div>
        </div>
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1">
            Max Pain
            <span title="The strike price where option buyers lose the most money" className="cursor-help text-zinc-600 text-[10px]">ⓘ</span>
          </div>
          <div className="text-lg font-bold text-purple-400">{maxPainStrike}</div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="rounded-xl border border-zinc-800/50 overflow-hidden bg-zinc-950/50">
        <div className="p-4 space-y-1">
          {sliced.map((item) => {
            const ceOI = item.CE?.openInterest || 0;
            const peOI = item.PE?.openInterest || 0;
            const isATM = item.strikePrice === atmStrike;

            return (
              <div key={item.strikePrice} className={`flex items-center gap-0 h-7 ${isATM ? 'relative' : ''}`}>
                {/* ATM highlight */}
                {isATM && (
                  <div className="absolute inset-0 border border-blue-500/40 bg-blue-500/5 rounded-md z-0 -mx-1"></div>
                )}

                {/* Call OI Bar (right-to-left, left side) */}
                <div className="flex-1 flex justify-end relative z-10">
                  <div className="w-full flex items-center justify-end gap-2">
                    <span className="text-xs font-mono text-emerald-400/70 min-w-[45px] text-right">
                      {ceOI > 0 ? formatOI(ceOI) : ''}
                    </span>
                    <div className="flex-1 flex justify-end max-w-[280px]">
                      <div
                        className="h-5 rounded-l-sm bg-gradient-to-l from-emerald-500/80 to-emerald-600/40 transition-all duration-500"
                        style={{ width: getBarWidth(ceOI) }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Strike Price (center) */}
                <div className={`w-[80px] text-center text-xs font-mono font-bold flex-shrink-0 relative z-10 ${
                  isATM ? 'text-blue-400' : 'text-zinc-400'
                }`}>
                  {item.strikePrice}
                </div>

                {/* Put OI Bar (left-to-right, right side) */}
                <div className="flex-1 flex justify-start relative z-10">
                  <div className="w-full flex items-center gap-2">
                    <div className="flex-1 flex justify-start max-w-[280px]">
                      <div
                        className="h-5 rounded-r-sm bg-gradient-to-r from-red-500/80 to-red-600/40 transition-all duration-500"
                        style={{ width: getBarWidth(peOI) }}
                      ></div>
                    </div>
                    <span className="text-xs font-mono text-red-400/70 min-w-[45px] text-left">
                      {peOI > 0 ? formatOI(peOI) : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800/50 text-xs text-zinc-500">
          <span>← Call OI (Resistance)</span>
          <span>Strike Price</span>
          <span>Put OI (Support) →</span>
        </div>
      </div>

      {/* Change in OI Bar Chart */}
      <div className="rounded-xl border border-zinc-800/50 overflow-hidden bg-zinc-950/50">
        <div className="px-4 py-3 border-b border-zinc-800/50">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Change in Open Interest</h3>
        </div>
        <div className="p-4 space-y-1">
          {(() => {
            let maxChgOI = 0;
            sliced.forEach((item) => {
              maxChgOI = Math.max(maxChgOI, Math.abs(item.CE?.changeinOpenInterest || 0), Math.abs(item.PE?.changeinOpenInterest || 0));
            });
            const getChgBarWidth = (val: number) => maxChgOI === 0 ? '0%' : `${(Math.abs(val) / maxChgOI) * 100}%`;

            return sliced.map((item) => {
              const ceChg = item.CE?.changeinOpenInterest || 0;
              const peChg = item.PE?.changeinOpenInterest || 0;
              const isATM = item.strikePrice === atmStrike;

              return (
                <div key={item.strikePrice} className={`flex items-center gap-0 h-7 ${isATM ? 'relative' : ''}`}>
                  {isATM && (
                    <div className="absolute inset-0 border border-blue-500/40 bg-blue-500/5 rounded-md z-0 -mx-1"></div>
                  )}

                  {/* CE Change in OI */}
                  <div className="flex-1 flex justify-end relative z-10">
                    <div className="w-full flex items-center justify-end gap-2">
                      <span className={`text-xs font-mono min-w-[45px] text-right ${ceChg >= 0 ? 'text-emerald-400/70' : 'text-orange-400/70'}`}>
                        {ceChg !== 0 ? (ceChg > 0 ? '+' : '') + formatOI(ceChg) : ''}
                      </span>
                      <div className="flex-1 flex justify-end max-w-[280px]">
                        <div
                          className={`h-5 rounded-l-sm transition-all duration-500 ${
                            ceChg >= 0
                              ? 'bg-gradient-to-l from-emerald-500/80 to-emerald-600/40'
                              : 'bg-gradient-to-l from-orange-500/80 to-orange-600/40'
                          }`}
                          style={{ width: getChgBarWidth(ceChg) }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  <div className={`w-[80px] text-center text-xs font-mono font-bold flex-shrink-0 relative z-10 ${
                    isATM ? 'text-blue-400' : 'text-zinc-400'
                  }`}>
                    {item.strikePrice}
                  </div>

                  {/* PE Change in OI */}
                  <div className="flex-1 flex justify-start relative z-10">
                    <div className="w-full flex items-center gap-2">
                      <div className="flex-1 flex justify-start max-w-[280px]">
                        <div
                          className={`h-5 rounded-r-sm transition-all duration-500 ${
                            peChg >= 0
                              ? 'bg-gradient-to-r from-red-500/80 to-red-600/40'
                              : 'bg-gradient-to-r from-orange-500/80 to-orange-600/40'
                          }`}
                          style={{ width: getChgBarWidth(peChg) }}
                        ></div>
                      </div>
                      <span className={`text-xs font-mono min-w-[45px] text-left ${peChg >= 0 ? 'text-red-400/70' : 'text-orange-400/70'}`}>
                        {peChg !== 0 ? (peChg > 0 ? '+' : '') + formatOI(peChg) : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800/50 text-xs text-zinc-500">
          <span>← Call OI Change</span>
          <span>Strike Price</span>
          <span>Put OI Change →</span>
        </div>
      </div>
    </div>
  );
}
