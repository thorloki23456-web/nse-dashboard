'use client';

import { useState, useEffect } from 'react';
import type { TechnicalAnalysisSnapshot, TechnicalCandleSnapshot } from '@/lib/types';

type CandleData = TechnicalCandleSnapshot;
type AnalysisData = TechnicalAnalysisSnapshot;

interface TechnicalAnalysisProps {
  symbol: string;
  analysisData?: AnalysisData | null;
  recentCandleData?: CandleData[];
  currentPriceValue?: number;
  candleCountValue?: number;
  loadingState?: boolean;
  errorMessage?: string;
}

export default function TechnicalAnalysis({
  symbol,
  analysisData,
  recentCandleData,
  currentPriceValue,
  candleCountValue,
  loadingState,
  errorMessage,
}: TechnicalAnalysisProps) {
  const usesExternalData =
    analysisData !== undefined ||
    recentCandleData !== undefined ||
    currentPriceValue !== undefined ||
    candleCountValue !== undefined ||
    loadingState !== undefined ||
    errorMessage !== undefined;
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [recentData, setRecentData] = useState<CandleData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [candleCount, setCandleCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!symbol || usesExternalData) return;

    const fetchAnalysis = () => {
      setLoading(true);
      setError('');
      fetch(`/api/technical-analysis?symbol=${encodeURIComponent(symbol)}&interval=3`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error && !data.analysis) {
            setError(data.error);
            return;
          }
          if (data.analysis) setAnalysis(data.analysis);
          if (data.recentData) setRecentData(data.recentData);
          if (data.currentPrice) setCurrentPrice(data.currentPrice);
          if (data.candleCount) setCandleCount(data.candleCount);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    };

    fetchAnalysis();
    const interval = setInterval(fetchAnalysis, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [symbol, usesExternalData]);

  if (!symbol) return null;

  const displayAnalysis = usesExternalData ? analysisData ?? null : analysis;
  const displayRecentData = usesExternalData ? recentCandleData ?? [] : recentData;
  const displayCurrentPrice = usesExternalData ? currentPriceValue ?? 0 : currentPrice;
  const displayCandleCount = usesExternalData ? candleCountValue ?? 0 : candleCount;
  const displayLoading = usesExternalData ? loadingState ?? false : loading;
  const displayError = usesExternalData ? errorMessage ?? '' : error;

  const signalConfig = {
    BUY: {
      bg: 'bg-green-500/10',
      border: 'border-green-500/40',
      text: 'text-green-400',
      icon: '🟢',
      action: 'BUY CE (Call)',
      putAction: 'SELL PE (Put)',
    },
    SELL: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/40',
      text: 'text-red-400',
      icon: '🔴',
      action: 'BUY PE (Put)',
      putAction: 'SELL CE (Call)',
    },
    NEUTRAL: {
      bg: 'bg-zinc-500/10',
      border: 'border-zinc-500/40',
      text: 'text-zinc-400',
      icon: '⚪',
      action: 'No Action',
      putAction: 'No Action',
    },
  };

  const getRSIColor = (rsi: number) => {
    if (rsi >= 70) return 'text-red-400';
    if (rsi <= 30) return 'text-green-400';
    if (rsi >= 60) return 'text-orange-400';
    if (rsi <= 40) return 'text-emerald-400';
    return 'text-zinc-300';
  };

  const getRSILabel = (rsi: number) => {
    if (rsi >= 70) return 'Overbought';
    if (rsi <= 30) return 'Oversold';
    if (rsi >= 60) return 'High';
    if (rsi <= 40) return 'Low';
    return 'Neutral';
  };

  const getRSIBarWidth = (rsi: number) => `${Math.min(Math.max(rsi, 0), 100)}%`;

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-100">
          Technical Analysis
          <span className="text-sm font-normal text-zinc-500 ml-2">(3-min candles • SuperTrend 7,2.5 • RSI 7)</span>
        </h2>
        {displayLoading && (
          <div className="flex items-center gap-2 text-blue-400 text-sm">
            <div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"></div>
            Analyzing...
          </div>
        )}
      </div>

      {displayError && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-yellow-400 text-sm">
          ⚠️ {displayError} — Market may be closed. Analysis will be available during trading hours.
        </div>
      )}

      {displayAnalysis && (
        <>
          {/* Signal Card */}
          <div className={`rounded-xl border-2 ${signalConfig[displayAnalysis.signal].border} ${signalConfig[displayAnalysis.signal].bg} p-6`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{signalConfig[displayAnalysis.signal].icon}</span>
                  <span className={`text-3xl font-black ${signalConfig[displayAnalysis.signal].text}`}>
                    {displayAnalysis.signal}
                  </span>
                </div>
                <p className="text-zinc-400 text-sm max-w-xl">{displayAnalysis.signalReason}</p>
              </div>

              {displayAnalysis.signal !== 'NEUTRAL' && (
                <div className="flex gap-3">
                  <div className="rounded-lg bg-zinc-800/80 border border-zinc-700/50 px-4 py-3 text-center">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Call Option</div>
                    <div className={`font-bold text-lg ${displayAnalysis.signal === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                      {displayAnalysis.signal === 'BUY' ? 'BUY' : 'SELL'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-800/80 border border-zinc-700/50 px-4 py-3 text-center">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Put Option</div>
                    <div className={`font-bold text-lg ${displayAnalysis.signal === 'BUY' ? 'text-red-400' : 'text-green-400'}`}>
                      {displayAnalysis.signal === 'BUY' ? 'SELL' : 'BUY'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Indicator Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* Current Price */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Price</div>
              <div className="text-xl font-bold text-zinc-100">{displayCurrentPrice.toLocaleString('en-IN')}</div>
            </div>

            {/* Trend */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">SuperTrend</div>
              <div className={`text-xl font-bold ${displayAnalysis.currentTrend === 'up' ? 'text-green-400' : displayAnalysis.currentTrend === 'down' ? 'text-red-400' : 'text-zinc-400'}`}>
                {displayAnalysis.currentTrend === 'up' ? '↑ UP' : displayAnalysis.currentTrend === 'down' ? '↓ DOWN' : '—'}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Level: {displayAnalysis.superTrendValue.toLocaleString('en-IN')}</div>
            </div>

            {/* RSI */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">RSI (7)</div>
              <div className={`text-xl font-bold ${getRSIColor(displayAnalysis.currentRSI)}`}>
                {displayAnalysis.currentRSI}
              </div>
              <div className="text-xs text-zinc-500 mt-1">{getRSILabel(displayAnalysis.currentRSI)}</div>
              {/* RSI bar */}
              <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    displayAnalysis.currentRSI >= 70 ? 'bg-red-500' :
                    displayAnalysis.currentRSI <= 30 ? 'bg-green-500' :
                    'bg-blue-500'
                  }`}
                  style={{ width: getRSIBarWidth(displayAnalysis.currentRSI) }}
                ></div>
              </div>
            </div>

            {/* ATR */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">ATR</div>
              <div className="text-xl font-bold text-zinc-100">{displayAnalysis.currentATR}</div>
              <div className="text-xs text-zinc-500 mt-1">Volatility</div>
            </div>

            {/* Candle Count */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Candles</div>
              <div className="text-xl font-bold text-zinc-100">{displayCandleCount}</div>
              <div className="text-xs text-zinc-500 mt-1">3-min intervals</div>
            </div>
          </div>

          {/* Recent Candles Table */}
          {displayRecentData.length > 0 && (
            <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
              <div className="px-4 py-3 bg-zinc-900/50 border-b border-zinc-800/50">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                  Recent Candles with Indicators (Last {displayRecentData.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700/50 text-zinc-400 text-xs uppercase tracking-wider">
                      <th className="px-3 py-2 text-left">Time</th>
                      <th className="px-3 py-2 text-right">Open</th>
                      <th className="px-3 py-2 text-right">High</th>
                      <th className="px-3 py-2 text-right">Low</th>
                      <th className="px-3 py-2 text-right">Close</th>
                      <th className="px-3 py-2 text-right">ATR</th>
                      <th className="px-3 py-2 text-right">SuperTrend</th>
                      <th className="px-3 py-2 text-center">Trend</th>
                      <th className="px-3 py-2 text-right">RSI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRecentData.map((candle, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                          idx === displayRecentData.length - 1 ? 'bg-zinc-800/20' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-zinc-300 font-mono">{candle.time}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-300">{candle.open.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-300">{candle.high.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-300">{candle.low.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${
                          candle.close >= candle.open ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {candle.close.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{candle.atr}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-300">
                          {candle.superTrend > 0 ? candle.superTrend.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {candle.trend === 'up' && (
                            <span className="px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold">
                              UP ↑
                            </span>
                          )}
                          {candle.trend === 'down' && (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">
                              DOWN ↓
                            </span>
                          )}
                          {candle.trend === 'none' && (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${getRSIColor(candle.rsi)}`}>
                          {candle.rsi}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
