'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import ConfluencePanel from '@/components/ConfluencePanel';
import ErrorBoundary from '@/components/ErrorBoundary';
import OIBarChart from '@/components/OIBarChart';
import OptionAnalysis from '@/components/OptionAnalysis';
import OptionChainDiffTable from '@/components/OptionChainDiffTable';
import OptionChainTable from '@/components/OptionChainTable';
import StraddleTracker from '@/components/StraddleTracker';
import StrategySimulator from '@/components/StrategySimulator';
import TechnicalAnalysis from '@/components/TechnicalAnalysis';
import { buildAnalyticsSnapshot, updateVolumeHistory } from '@/lib/analytics';
import type { AnalyticsSnapshot, OptionChainDiff, OptionStrike } from '@/lib/types';

interface SymbolsPayload {
  data?: {
    IndexList?: Array<{ symbol?: string }>;
    UnderlyingList?: Array<{ symbol?: string }>;
  };
  IndexList?: Array<{ symbol?: string }>;
  UnderlyingList?: Array<{ symbol?: string }>;
}

interface OptionChainPayload {
  data: OptionStrike[];
  timestamp: string;
  underlyingValue: number;
}

function calculateOptionChainDiff(previousData: OptionStrike[], nextData: OptionStrike[]): OptionChainDiff[] {
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

function normalizeSymbolList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const symbol = (entry as { symbol?: unknown }).symbol;
    return typeof symbol === 'string' && symbol.length > 0 ? [symbol] : [];
  });
}

function parseSymbolsPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return { indices: [], stocks: [] };
  }

  const source = payload as SymbolsPayload;
  const symbolData = source.data ?? source;

  return {
    indices: normalizeSymbolList(symbolData.IndexList),
    stocks: normalizeSymbolList(symbolData.UnderlyingList),
  };
}

function parseExpiryPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const raw = (payload as { expiryDates?: unknown }).expiryDates;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function parseOptionChainPayload(payload: unknown): OptionChainPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const source = payload as {
    data?: unknown;
    timestamp?: unknown;
    underlyingValue?: unknown;
  };

  if (!Array.isArray(source.data)) {
    return null;
  }

  return {
    data: source.data as OptionStrike[],
    timestamp: typeof source.timestamp === 'string' ? source.timestamp : '',
    underlyingValue: typeof source.underlyingValue === 'number' ? source.underlyingValue : 0,
  };
}

function totalVolume(strikes: OptionStrike[]) {
  return strikes.reduce(
    (sum, strike) =>
      sum +
      (strike.CE?.totalTradedVolume ?? 0) +
      (strike.PE?.totalTradedVolume ?? 0),
    0
  );
}

export default function Home() {
  const [symbols, setSymbols] = useState<{ indices: string[]; stocks: string[] }>({
    indices: [],
    stocks: [],
  });
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chainData, setChainData] = useState<OptionStrike[]>([]);
  const [diffData, setDiffData] = useState<OptionChainDiff[]>([]);
  const [timestamp, setTimestamp] = useState('');
  const [underlyingValue, setUnderlyingValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [volumeHistory, setVolumeHistory] = useState<number[]>([]);
  const previousChainRef = useRef<OptionStrike[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadSymbols() {
      try {
        const response = await fetch('/api/symbols');
        const payload = await response.json();
        if (!cancelled) {
          setSymbols(parseSymbolsPayload(payload));
        }
      } catch (error) {
        console.error('Failed to fetch symbols:', error);
      }
    }

    void loadSymbols();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    let cancelled = false;

    async function loadExpiries() {
      try {
        const response = await fetch(`/api/expiry-dates?symbol=${selectedSymbol}`);
        const payload = await response.json();
        const parsedExpiries = parseExpiryPayload(payload);

        if (cancelled) {
          return;
        }

        setExpiries(parsedExpiries);
        setSelectedExpiry((current) => {
          if (current && parsedExpiries.includes(current)) {
            return current;
          }

          return parsedExpiries[0] ?? '';
        });
      } catch (error) {
        console.error('Failed to fetch expiries:', error);
      }
    }

    void loadExpiries();

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol || !selectedExpiry) {
      return;
    }

    let cancelled = false;

    async function fetchChainData() {
      setLoading(true);

      try {
        const response = await fetch(
          `/api/option-chain?symbol=${selectedSymbol}&expiryDate=${selectedExpiry}`
        );
        const payload = await response.json();
        const parsed = parseOptionChainPayload(payload);

        if (!parsed || cancelled) {
          return;
        }

        const nextData = parsed.data;
        const nextDiffs =
          previousChainRef.current.length > 0
            ? calculateOptionChainDiff(previousChainRef.current, nextData)
            : [];

        previousChainRef.current = nextData;

        startTransition(() => {
          setChainData(nextData);
          setDiffData(nextDiffs);
          setTimestamp(parsed.timestamp);
          setUnderlyingValue(parsed.underlyingValue);
          setVolumeHistory((current) => updateVolumeHistory(current, totalVolume(nextData)));
        });
      } catch (error) {
        console.error('Failed to fetch option chain:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchChainData();
    const interval = window.setInterval(fetchChainData, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedSymbol, selectedExpiry]);

  const analyticsSnapshot = useMemo<AnalyticsSnapshot | null>(() => {
    if (!selectedSymbol || !selectedExpiry || chainData.length === 0 || underlyingValue <= 0) {
      return null;
    }

    return buildAnalyticsSnapshot({
      symbol: selectedSymbol,
      expiryDate: selectedExpiry,
      timestamp,
      underlyingValue,
      strikes: chainData,
      context: {
        strategy: 'gamma',
        volumeHistory,
      },
    });
  }, [selectedSymbol, selectedExpiry, chainData, timestamp, underlyingValue, volumeHistory]);

  const handleSymbolChange = (symbol: string) => {
    startTransition(() => {
      setSelectedSymbol(symbol);
      setExpiries([]);
      setSelectedExpiry('');
      setChainData([]);
      setDiffData([]);
      setTimestamp('');
      setUnderlyingValue(0);
      setVolumeHistory([]);
      previousChainRef.current = [];
    });
  };

  const handleExpiryChange = (expiry: string) => {
    startTransition(() => {
      setSelectedExpiry(expiry);
      setDiffData([]);
      setVolumeHistory([]);
      previousChainRef.current = [];
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-3xl font-bold text-transparent">
            NSE Options Analytics Platform
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Real-time option structure, dealer positioning, and confluence-driven trade context.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-6 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-400">Symbol</label>
            <select
              value={selectedSymbol}
              onChange={(event) => handleSymbolChange(event.target.value)}
              className="min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">Select Symbol</option>
              <optgroup label="Indices">
                {symbols.indices.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Stocks">
                {symbols.stocks.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {selectedSymbol ? (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-zinc-400">Expiry</label>
              <select
                value={selectedExpiry}
                onChange={(event) => handleExpiryChange(event.target.value)}
                className="min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                <option value="">Select Expiry</option>
                {expiries.map((expiry) => (
                  <option key={expiry} value={expiry}>
                    {expiry}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400" />
              Fetching data...
            </div>
          ) : null}
        </div>

        <ErrorBoundary fallback={<div className="text-zinc-500">Confluence engine unavailable.</div>}>
          <ConfluencePanel
            snapshot={analyticsSnapshot}
            symbol={selectedSymbol}
            expiryDate={selectedExpiry}
            loading={loading}
          />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Option chain unavailable.</div>}>
          <OptionChainTable
            data={chainData}
            timestamp={timestamp}
            underlyingValue={underlyingValue}
          />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Delta table unavailable.</div>}>
          <OptionChainDiffTable diffData={diffData} />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">OI chart unavailable.</div>}>
          <OIBarChart data={chainData} strikesAroundATM={10} />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Technical analysis unavailable.</div>}>
          <TechnicalAnalysis symbol={selectedSymbol} />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Option analysis unavailable.</div>}>
          <OptionAnalysis data={chainData} />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Straddle tracker unavailable.</div>}>
          <StraddleTracker data={chainData} />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="text-zinc-500">Strategy simulator unavailable.</div>}>
          <StrategySimulator symbol={selectedSymbol} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
