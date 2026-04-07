'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OptionChainTable from '@/components/OptionChainTable';
import OptionChainDiffTable from '@/components/OptionChainDiffTable';
import OIBarChart from '@/components/OIBarChart';
import OptionAnalysis from '@/components/OptionAnalysis';
import TechnicalAnalysis from '@/components/TechnicalAnalysis';
import StraddleTracker from '@/components/StraddleTracker';
import StrategySimulator from '@/components/StrategySimulator';
import ConfluencePanel from '@/components/ConfluencePanel';
import IVSkewChart from '@/components/IVSkewChart';
import GEXChart from '@/components/GEXChart';
import MaxPainPanel from '@/components/MaxPainPanel';
import EntryDecisionPanel from '@/components/EntryDecisionPanel';
import ErrorBoundary from '@/components/ErrorBoundary';
import type { ConfluenceResult, OptionChainDiff, OptionStrike } from '@/lib/types';
import * as AnalyticsLib from '@/lib/analytics';
import * as ConfluenceEngineLib from '@/lib/confluence-engine';

type OptionData = OptionStrike;

interface SymbolsPayload {
  data?: {
    IndexList?: { symbol?: string }[];
    UnderlyingList?: { symbol?: string }[];
  };
  IndexList?: { symbol?: string }[];
  UnderlyingList?: { symbol?: string }[];
}

type DynamicModuleFunction = (...args: readonly unknown[]) => unknown;

function calculateOptionChainDiff(previousData: OptionData[], nextData: OptionData[]): OptionChainDiff[] {
  const previousByStrike = new Map(previousData.map((item) => [item.strikePrice, item]));
  return nextData.map((item) => {
    const previousItem = previousByStrike.get(item.strikePrice);
    return {
      strike: item.strikePrice,
      ce_oi_diff: (item.CE?.openInterest ?? 0) - (previousItem?.CE?.openInterest ?? 0),
      pe_oi_diff: (item.PE?.openInterest ?? 0) - (previousItem?.PE?.openInterest ?? 0),
      ce_vol_diff: (item.CE?.totalTradedVolume ?? 0) - (previousItem?.CE?.totalTradedVolume ?? 0),
      pe_vol_diff: (item.PE?.totalTradedVolume ?? 0) - (previousItem?.PE?.totalTradedVolume ?? 0),
    };
  });
}

function normalizeSymbolList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const symbols: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const symbol = (entry as { symbol?: unknown }).symbol;
    if (typeof symbol === 'string' && symbol.length > 0) symbols.push(symbol);
  }
  return symbols;
}

function parseSymbolsPayload(payload: unknown): { indices: string[]; stocks: string[] } {
  if (!payload || typeof payload !== 'object') return { indices: [], stocks: [] };
  const source = payload as SymbolsPayload;
  const symbolData = source.data ?? source;
  return {
    indices: normalizeSymbolList(symbolData.IndexList),
    stocks: normalizeSymbolList(symbolData.UnderlyingList),
  };
}

function parseExpiryPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { expiryDates?: unknown }).expiryDates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function parseOptionChainPayload(payload: unknown): {
  data: OptionData[];
  timestamp: string;
  underlyingValue: number;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as { data?: unknown; timestamp?: unknown; underlyingValue?: unknown };
  const data = Array.isArray(source.data) ? (source.data as OptionData[]) : [];
  const timestamp = typeof source.timestamp === 'string' ? source.timestamp : '';
  const underlyingValue = typeof source.underlyingValue === 'number' ? source.underlyingValue : 0;
  return { data, timestamp, underlyingValue };
}

function resolveModuleFunction(
  moduleObject: object,
  candidates: readonly string[]
): DynamicModuleFunction | null {
  const moduleRecord = moduleObject as Record<string, unknown>;
  for (const candidateName of candidates) {
    const candidate = moduleRecord[candidateName];
    if (typeof candidate === 'function') return candidate as DynamicModuleFunction;
  }
  return null;
}

function toConfluenceResult(value: unknown): ConfluenceResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.regime !== 'string') return null;
  if (typeof candidate.confidence !== 'number') return null;
  if (typeof candidate.bullishScore !== 'number') return null;
  if (typeof candidate.bearishScore !== 'number') return null;
  return value as ConfluenceResult;
}

export default function Home() {
  const [symbols, setSymbols] = useState<{ indices: string[]; stocks: string[] }>({ indices: [], stocks: [] });
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [chainData, setChainData] = useState<OptionData[]>([]);
  const [diffData, setDiffData] = useState<OptionChainDiff[]>([]);
  const [timestamp, setTimestamp] = useState<string>('');
  const [underlyingValue, setUnderlyingValue] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const previousChainRef = useRef<OptionData[]>([]);

  // Active tab for enhanced panels
  const [activeTab, setActiveTab] = useState<'chain' | 'analytics' | 'entry'>('chain');

  useEffect(() => {
    fetch('/api/symbols')
      .then((r) => r.json())
      .then((payload: unknown) => setSymbols(parseSymbolsPayload(payload)))
      .catch((e: unknown) => console.error('Failed to fetch symbols:', e));
  }, []);

  useEffect(() => {
    if (selectedSymbol) {
      setChainData([]);
      setDiffData([]);
      setTimestamp('');
      setUnderlyingValue(0);
      previousChainRef.current = [];
      fetch(`/api/expiry-dates?symbol=${selectedSymbol}`)
        .then((r) => r.json())
        .then((payload: unknown) => {
          const parsedExpiries = parseExpiryPayload(payload);
          setExpiries(parsedExpiries);
          setSelectedExpiry(parsedExpiries.length > 0 ? parsedExpiries[0] : '');
        });
    } else {
      setExpiries([]);
      setSelectedExpiry('');
      setChainData([]);
      setDiffData([]);
      setUnderlyingValue(0);
      previousChainRef.current = [];
    }
  }, [selectedSymbol]);

  useEffect(() => {
    setDiffData([]);
    previousChainRef.current = [];
  }, [selectedExpiry]);

  useEffect(() => {
    if (selectedSymbol && selectedExpiry) {
      const fetchData = () => {
        setLoading(true);
        fetch(`/api/option-chain?symbol=${selectedSymbol}&expiryDate=${selectedExpiry}`)
          .then((r) => r.json())
          .then((payload: unknown) => {
            const parsed = parseOptionChainPayload(payload);
            if (!parsed) return;
            if (Array.isArray(parsed.data)) {
              const nextData = parsed.data;
              setDiffData(
                previousChainRef.current.length > 0
                  ? calculateOptionChainDiff(previousChainRef.current, nextData)
                  : []
              );
              setChainData(nextData);
              previousChainRef.current = nextData;
            }
            setTimestamp(parsed.timestamp);
            setUnderlyingValue(parsed.underlyingValue);
          })
          .catch((e: unknown) => console.error('Failed to fetch option chain:', e))
          .finally(() => setLoading(false));
      };
      fetchData();
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [selectedSymbol, selectedExpiry]);

  const confluence = useMemo<ConfluenceResult | null>(() => {
    if (!selectedSymbol || !selectedExpiry || chainData.length === 0) return null;

    const snapshotBuilder = resolveModuleFunction(AnalyticsLib, [
      'buildAnalyticsSnapshot',
      'computeAnalyticsSnapshot',
      'computeAnalytics',
      'deriveAnalytics',
      'createAnalyticsSnapshot',
    ]);

    const confluenceEngine = resolveModuleFunction(ConfluenceEngineLib, [
      'computeConfluence',
      'runConfluenceEngine',
      'evaluateConfluence',
    ]);

    const analyticsInput = {
      symbol: selectedSymbol,
      expiryDate: selectedExpiry,
      chain: chainData,
      chainData,
      diffData,
      underlyingValue,
      timestamp,
    };

    const analyticsSnapshot = snapshotBuilder ? snapshotBuilder(analyticsInput) : analyticsInput;

    const directAnalyticsConfluence = resolveModuleFunction(AnalyticsLib, [
      'computeConfluenceFromAnalytics',
      'computeConfluenceFromSnapshot',
      'computeConfluence',
    ]);

    const rawResult = confluenceEngine
      ? confluenceEngine(analyticsSnapshot)
      : directAnalyticsConfluence
        ? directAnalyticsConfluence(analyticsSnapshot)
        : null;

    return toConfluenceResult(rawResult);
  }, [selectedSymbol, selectedExpiry, chainData, diffData, underlyingValue, timestamp]);

  const tabs = [
    { id: 'chain' as const, label: 'Option Chain' },
    { id: 'analytics' as const, label: 'Analytics' },
    { id: 'entry' as const, label: 'Entry Engine' },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            NSE Options Analytics Platform
          </h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Live option chain · Confluence engine · IV skew · GEX · Max pain · Entry scoring
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-6 mb-6 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-400">Symbol</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[160px]"
            >
              <option value="">Select Symbol</option>
              <optgroup label="Indices">
                {symbols.indices.map((sym) => <option key={sym} value={sym}>{sym}</option>)}
              </optgroup>
              <optgroup label="Stocks">
                {symbols.stocks.map((sym) => <option key={sym} value={sym}>{sym}</option>)}
              </optgroup>
            </select>
          </div>

          {selectedSymbol && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-zinc-400">Expiry</label>
              <select
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[160px]"
              >
                <option value="">Select Expiry</option>
                {expiries.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
              </select>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-blue-400 text-sm">
              <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
              Fetching data...
            </div>
          )}

          {timestamp && (
            <div className="ml-auto text-xs text-zinc-500 self-center">
              Last updated: {timestamp}
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 p-1 rounded-lg bg-zinc-900/50 border border-zinc-800/50 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Option Chain */}
        {activeTab === 'chain' && (
          <>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Option chain unavailable</div>}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <OptionChainTable data={chainData as any} timestamp={timestamp} underlyingValue={underlyingValue} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Diff table unavailable</div>}>
              <OptionChainDiffTable diffData={diffData} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">OI chart unavailable</div>}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <OIBarChart data={chainData as any} strikesAroundATM={10} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Straddle tracker unavailable</div>}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <StraddleTracker data={chainData as any} />
            </ErrorBoundary>
          </>
        )}

        {/* Tab: Analytics */}
        {activeTab === 'analytics' && (
          <>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Confluence panel unavailable</div>}>
              <ConfluencePanel
                confluence={confluence}
                symbol={selectedSymbol}
                expiryDate={selectedExpiry}
                loading={loading}
              />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">IV Skew chart unavailable</div>}>
              <IVSkewChart data={chainData as unknown as import('@/lib/types').OptionStrike[]} underlyingValue={underlyingValue} strikesAroundATM={10} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">GEX chart unavailable</div>}>
              <GEXChart data={chainData as unknown as import('@/lib/types').OptionStrike[]} underlyingValue={underlyingValue} strikesAroundATM={10} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Max pain panel unavailable</div>}>
              <MaxPainPanel data={chainData as unknown as import('@/lib/types').OptionStrike[]} underlyingValue={underlyingValue} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Option analysis unavailable</div>}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <OptionAnalysis data={chainData as any} />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Technical analysis unavailable</div>}>
              <TechnicalAnalysis symbol={selectedSymbol} />
            </ErrorBoundary>
          </>
        )}

        {/* Tab: Entry Engine */}
        {activeTab === 'entry' && (
          <>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Entry decision panel unavailable</div>}>
              <EntryDecisionPanel
                data={chainData as unknown as import('@/lib/types').OptionStrike[]}
                underlyingValue={underlyingValue}
                symbol={selectedSymbol}
                expiryDate={selectedExpiry}
              />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="text-zinc-500 p-4">Strategy simulator unavailable</div>}>
              <StrategySimulator symbol={selectedSymbol} />
            </ErrorBoundary>
          </>
        )}
      </div>
    </div>
  );
}
