'use client';

import { useState, useEffect, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { 
  generateMACrossover, 
  generateRSIMomentum, 
  generateBollingerMeanReversion, 
  generateVolatilityBreakout 
} from '@/lib/strategies';

interface StrategySimulatorProps {
  symbol: string;
}

type StrategyType = 'MA_CROSSOVER' | 'RSI_MOMENTUM' | 'BOLLINGER_REVERSION' | 'BREAKOUT';

export default function StrategySimulator({ symbol }: StrategySimulatorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('MA_CROSSOVER');
  const [historicalPrices, setHistoricalPrices] = useState<number[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch intraday chart data to feed the strategies
  useEffect(() => {
    if (!symbol) return;
    
    let isMounted = true;
    const fetchIntraday = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/technical-analysis?symbol=${symbol}&interval=3`);
        const data = await res.json();
        const candleData = Array.isArray(data.recentData)
          ? data.recentData
          : Array.isArray(data.data)
            ? data.data
            : [];

        if (isMounted) {
          const prices = candleData.map((c: { close: number }) => c.close);
          setHistoricalPrices(prices);
          setCurrentPrice(typeof data.currentPrice === 'number' ? data.currentPrice : null);
        }
      } catch (err) {
        console.error("Failed to fetch historical prices for strategy", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchIntraday();
    const interval = setInterval(fetchIntraday, 30000); // refresh every 30s
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol]);

  const displaySpotPrice = historicalPrices[historicalPrices.length - 1] ?? currentPrice ?? 0;

  // Run the selected strategy on the historical prices
  const strategyResult = useMemo(() => {
    if (historicalPrices.length === 0) return { signals: [], lastSignal: 0, backtestStats: null };

    let signals: number[] = [];
    let name = '';
    
    switch (selectedStrategy) {
      case 'MA_CROSSOVER':
        signals = generateMACrossover(historicalPrices, 5, 10);
        name = 'Simple MA Crossover (5/10)';
        break;
      case 'RSI_MOMENTUM':
        signals = generateRSIMomentum(historicalPrices, 14, 50);
        name = 'RSI Momentum w/ EMA Trend Filter';
        break;
      case 'BOLLINGER_REVERSION':
        signals = generateBollingerMeanReversion(historicalPrices, 20, 2);
        name = 'Bollinger Bands Mean Reversion';
        break;
      case 'BREAKOUT':
        signals = generateVolatilityBreakout(historicalPrices, 20, 14);
        name = 'Volatility Breakout (ATR Confirmed)';
        break;
    }

    const lastSignal = signals[signals.length - 1] || 0;
    
    // Quick pseudo-backtest stats
    let trades = 0;
    let currentlyHolding = false;

    signals.forEach(sig => {
      if (sig === 1 && !currentlyHolding) {
        trades++;
        currentlyHolding = true;
      } else if (sig === -1 && currentlyHolding) {
        currentlyHolding = false;
      }
    });

    return { signals, lastSignal, trades, name };
  }, [historicalPrices, selectedStrategy]);

  if (!symbol) return null;

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-950/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Spot Strategy Sandbox
          </h2>
          <p className="text-sm text-zinc-400">Run algorithmic strategies on the underlying spot price</p>
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 px-3 py-2 rounded-lg outline-none w-64 focus:border-indigo-500/50 transition-colors"
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value as StrategyType)}
          >
            <option value="MA_CROSSOVER">MA Crossover (Trend Following)</option>
            <option value="RSI_MOMENTUM">RSI Momentum (Trend Filtered)</option>
            <option value="BOLLINGER_REVERSION">Bollinger Mean Reversion</option>
            <option value="BREAKOUT">Volatility Breakout (ATR)</option>
          </select>
        </div>
      </div>

      <div className="p-5 relative min-h-[160px]">
        {loading && historicalPrices.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-10">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Active Signal Panel */}
          <div className="col-span-1 border border-zinc-800/50 bg-zinc-900/30 rounded-xl p-5 flex flex-col items-center justify-center text-center">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Live Algorithm Signal</div>
            <div className={`px-6 py-2 rounded-lg text-lg font-bold tracking-widest ${
              strategyResult.lastSignal === 1 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                : strategyResult.lastSignal === -1 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]' 
                  : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/50'
            }`}>
              {strategyResult.lastSignal === 1 ? 'BUY' : strategyResult.lastSignal === -1 ? 'SELL' : 'HOLD'}
            </div>
            <div className="text-xs text-zinc-500 mt-3 font-mono">
              Eval: {historicalPrices.length} candles
            </div>
          </div>

          {/* Strategy Details */}
          <div className="col-span-1 md:col-span-2 border border-zinc-800/50 bg-zinc-900/30 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <h3 className="text-zinc-200 font-medium text-lg flex items-center gap-2">
                {strategyResult.name}
              </h3>
              <p className="text-zinc-500 text-sm mt-1">
                {selectedStrategy === 'MA_CROSSOVER' && 'Executes trades when the fast Simple Moving Average (5-period) crosses the slow SMA (10-period). Highly effective in strongly trending intraday markets.'}
                {selectedStrategy === 'RSI_MOMENTUM' && 'Triggers when the RSI dips to oversold levels while the price remains above a 50-period EMA, effectively buying pullbacks in an established uptrend.'}
                {selectedStrategy === 'BOLLINGER_REVERSION' && 'Assumes the asset is mean-reverting. Emits Buy signals when the price breaches the lower standard deviation band, and Sell when it touches the upper band.'}
                {selectedStrategy === 'BREAKOUT' && 'Detects sideways consolidation via Support/Resistance levels (20 periods). Fires a Buy on breakout, strictly validated by an Average True Range (ATR) expansion spike.'}
              </p>
            </div>
            
            <div className="flex gap-6 mt-4 pt-4 border-t border-zinc-800/50">
              <div>
                <div className="text-xs text-zinc-500">Intraday Trades Hit</div>
                <div className="text-xl font-mono text-zinc-300 mt-0.5">{strategyResult.trades}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Current Spot Level</div>
                <div className="text-xl font-mono text-zinc-300 mt-0.5">
                  {displaySpotPrice.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
