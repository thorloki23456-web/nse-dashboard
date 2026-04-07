'use client';

import { useState, useEffect, useMemo } from 'react';
import { Play, Square, Settings2, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface OptionLeg {
  openInterest: number;
  changeinOpenInterest: number;
  totalTradedVolume: number;
  lastPrice: number;
}

interface OptionData {
  strikePrice: number;
  CE?: OptionLeg;
  PE?: OptionLeg;
}

interface StraddleTrackerProps {
  data: OptionData[];
}

type StrategyType = 'COMBINED_TRAILING' | 'INDIVIDUAL_LEG_PERCENT';
type StatusType = 'IDLE' | 'ACTIVE' | 'STOP_LOSS_HIT' | 'TARGET_HIT';

export default function StraddleTracker({ data }: StraddleTrackerProps) {
  // Configuration
  const [strategyType, setStrategyType] = useState<StrategyType>('INDIVIDUAL_LEG_PERCENT');
  const [stopLoss, setStopLoss] = useState<number>(25); // Defaults: 25% for individual, 5pts for combined
  const [tsl, setTsl] = useState<number>(1); // Only used in combined trailing
  const [targetProfit, setTargetProfit] = useState<number>(5000); // Monetary target profit
  const [lotSize, setLotSize] = useState<number>(50); // Default to Nifty
  const [lots, setLots] = useState<number>(1);

  // Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState<StatusType>('IDLE');

  // Trade Data
  const [trackedStrike, setTrackedStrike] = useState<number>(0);
  const [entryTime, setEntryTime] = useState<string>('');
  const [entryCE, setEntryCE] = useState<number>(0);
  const [entryPE, setEntryPE] = useState<number>(0);

  // Real-time Data
  const [currentCE, setCurrentCE] = useState<number>(0);
  const [currentPE, setCurrentPE] = useState<number>(0);

  // Leg Status for INDIVIDUAL_LEG_PERCENT
  const [ceStatus, setCeStatus] = useState<'ACTIVE' | 'SL_HIT'>('ACTIVE');
  const [peStatus, setPeStatus] = useState<'ACTIVE' | 'SL_HIT'>('ACTIVE');
  const [ceExitPrice, setCeExitPrice] = useState<number>(0);
  const [peExitPrice, setPeExitPrice] = useState<number>(0);

  // SL State (for combined trailing)
  const [basePremium, setBasePremium] = useState<number>(0);
  const [currentSL, setCurrentSL] = useState<number>(0);

  const entryPremium = entryCE + entryPE;
  const activeCEPrice = ceStatus === 'ACTIVE' ? currentCE : ceExitPrice;
  const activePEPrice = peStatus === 'ACTIVE' ? currentPE : peExitPrice;
  const currentPremium = activeCEPrice + activePEPrice;

  // Identify ATM strike from real-time data
  const atmStrike = useMemo(() => {
    if (!data || data.length === 0) return 0;
    const sorted = [...data]
      .filter((d) => d.CE && d.PE)
      .sort((a, b) => a.strikePrice - b.strikePrice);

    let minDiff = Infinity;
    let atm = 0;
    sorted.forEach((item) => {
      const diff = Math.abs((item.CE?.lastPrice || 0) - (item.PE?.lastPrice || 0));
      if (diff < minDiff) {
        minDiff = diff;
        atm = item.strikePrice;
      }
    });
    return atm;
  }, [data]);

  // Handle live data updates when tracking
  useEffect(() => {
    if (!isTracking || status === 'IDLE' || !data || data.length === 0) return;

    const currentOption = data.find(d => d.strikePrice === trackedStrike);
    if (!currentOption) return;

    const ceLtp = currentOption.CE?.lastPrice || 0;
    const peLtp = currentOption.PE?.lastPrice || 0;

    // Only update active legs
    if (ceStatus === 'ACTIVE') setCurrentCE(ceLtp);
    if (peStatus === 'ACTIVE') setCurrentPE(peLtp);

    const ceActiveLtp = ceStatus === 'ACTIVE' ? ceLtp : ceExitPrice;
    const peActiveLtp = peStatus === 'ACTIVE' ? peLtp : peExitPrice;
    const newPremium = ceActiveLtp + peActiveLtp;

    // Check Monetary Target Profit
    const currentPointsGain = entryPremium - newPremium;
    const currentMtm = currentPointsGain * lotSize * lots;

    if (targetProfit > 0 && currentMtm >= targetProfit) {
      if (ceStatus === 'ACTIVE') setCeExitPrice(ceLtp);
      if (peStatus === 'ACTIVE') setPeExitPrice(peLtp);
      setStatus('TARGET_HIT');
      setIsTracking(false);
      return;
    }

    if (strategyType === 'COMBINED_TRAILING') {
      let newBasePremium = basePremium;
      let newCurrentSL = currentSL;

      // Trailing Logic
      if (newPremium <= basePremium - tsl) {
        newBasePremium = newPremium;
        newCurrentSL = newPremium + stopLoss;
        setBasePremium(newBasePremium);
        setCurrentSL(newCurrentSL);
      }

      // Stop Loss Hit
      if (newPremium >= newCurrentSL) {
        setStatus('STOP_LOSS_HIT');
        setIsTracking(false);
      }
    }
    else if (strategyType === 'INDIVIDUAL_LEG_PERCENT') {
      let bothHit = true;

      if (ceStatus === 'ACTIVE') {
        const ceSlPrice = entryCE * (1 + stopLoss / 100);
        if (ceLtp >= ceSlPrice) {
          setCeStatus('SL_HIT');
          setCeExitPrice(ceLtp);
        } else {
          bothHit = false;
        }
      }

      if (peStatus === 'ACTIVE') {
        const peSlPrice = entryPE * (1 + stopLoss / 100);
        if (peLtp >= peSlPrice) {
          setPeStatus('SL_HIT');
          setPeExitPrice(peLtp);
        } else {
          bothHit = false;
        }
      }

      // If both legs hit SL
      if (bothHit && status === 'ACTIVE') {
        setStatus('STOP_LOSS_HIT');
        setIsTracking(false);
      }
    }

  }, [data, isTracking, status, trackedStrike, basePremium, currentSL, stopLoss, tsl, strategyType, entryCE, entryPE, targetProfit, entryPremium, lotSize, lots, ceStatus, peStatus, ceExitPrice, peExitPrice]);

  const handleStart = () => {
    if (!atmStrike || !data) return;

    const atmData = data.find(d => d.strikePrice === atmStrike);
    if (!atmData) return;

    const ceLtp = atmData.CE?.lastPrice || 0;
    const peLtp = atmData.PE?.lastPrice || 0;
    const premium = ceLtp + peLtp;

    setTrackedStrike(atmStrike);
    setEntryCE(ceLtp);
    setEntryPE(peLtp);
    setBasePremium(premium);
    setCurrentSL(premium + (strategyType === 'COMBINED_TRAILING' ? stopLoss : 0));

    setCurrentCE(ceLtp);
    setCurrentPE(peLtp);

    setCeStatus('ACTIVE');
    setPeStatus('ACTIVE');
    setCeExitPrice(0);
    setPeExitPrice(0);

    setEntryTime(new Date().toLocaleTimeString());
    setStatus('ACTIVE');
    setIsTracking(true);
  };

  const handleStop = () => {
    setIsTracking(false);
    setStatus('IDLE');
    setTrackedStrike(0);
    setEntryTime('');
    setEntryCE(0);
    setEntryPE(0);
    setCurrentCE(0);
    setCurrentPE(0);
    setCeStatus('ACTIVE');
    setPeStatus('ACTIVE');
    setCeExitPrice(0);
    setPeExitPrice(0);
    setBasePremium(0);
    setCurrentSL(0);
  };

  const handleStrategyChange = (type: StrategyType) => {
    setStrategyType(type);
    if (type === 'INDIVIDUAL_LEG_PERCENT') setStopLoss(25);
    else setStopLoss(5);
  };

  const currentPointsGain = entryPremium - currentPremium;
  const currentMtm = currentPointsGain * lotSize * lots;

  return (
    <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-950/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-zinc-400" />
            Short Straddle Simulator
          </h2>
          <p className="text-sm text-zinc-400">Track automated strategies using live option chain data.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 px-3 py-2 rounded-lg outline-none"
            value={strategyType}
            onChange={(e) => handleStrategyChange(e.target.value as StrategyType)}
            disabled={isTracking || status !== 'IDLE'}
          >
            <option value="INDIVIDUAL_LEG_PERCENT">Straddle: Leg-wise % SL</option>
            <option value="COMBINED_TRAILING">Straddle: Combined Trailing SL</option>
          </select>

          <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-xs text-zinc-500 font-medium">SL {strategyType === 'INDIVIDUAL_LEG_PERCENT' ? '(%)' : '(pts)'}</span>
            <input
              type="number"
              value={stopLoss}
              onChange={e => setStopLoss(Number(e.target.value))}
              disabled={isTracking || status !== 'IDLE'}
              className="w-12 bg-transparent text-right text-sm text-zinc-200 outline-none"
            />
          </div>

          {strategyType === 'COMBINED_TRAILING' && (
            <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-500 font-medium">TSL (pts)</span>
              <input
                type="number"
                value={tsl}
                onChange={e => setTsl(Number(e.target.value))}
                disabled={isTracking || status !== 'IDLE'}
                className="w-12 bg-transparent text-right text-sm text-zinc-200 outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-xs text-green-500/70 font-medium">Target ₹</span>
            <input
              type="number"
              value={targetProfit}
              onChange={e => setTargetProfit(Number(e.target.value))}
              disabled={isTracking || status !== 'IDLE'}
              className="w-16 bg-transparent text-right text-sm text-zinc-200 outline-none"
            />
          </div>

          <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-xs text-zinc-500 font-medium">Qty</span>
            <input
              type="number"
              value={lots}
              onChange={e => setLots(Number(e.target.value))}
              disabled={isTracking || status !== 'IDLE'}
              className="w-8 bg-transparent text-right text-sm text-zinc-200 outline-none"
            />
            <span className="text-zinc-500">x</span>
            <input
              type="number"
              value={lotSize}
              onChange={e => setLotSize(Number(e.target.value))}
              disabled={isTracking || status !== 'IDLE'}
              className="w-10 bg-transparent text-left text-sm text-zinc-200 outline-none"
            />
          </div>

          {!isTracking && status === 'IDLE' ? (
            <button
              onClick={handleStart}
              disabled={!atmStrike}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> Start
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border border-zinc-700"
            >
              <Square className="w-4 h-4" /> {status === 'ACTIVE' ? 'Stop' : 'Reset'}
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {status === 'IDLE' ? (
          <div className="text-center py-8 text-zinc-500">
            <p>Configure your strategy and click "Start" to simulate a Short Straddle at the ATM strike ({atmStrike || '...'})</p>
            <p className="text-xs mt-2 text-zinc-600 max-w-xl mx-auto">
              {strategyType === 'INDIVIDUAL_LEG_PERCENT'
                ? 'This strategy applies an independent percentage-based stop loss to the Call and Put options. If one leg hits the stop loss, it exits that leg but keeps the other running.'
                : 'This strategy tracks the combined premium of both legs. If the premium shrinks, it trails the Stop Loss downward by your TSL points to lock in profits.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

            {/* Status Panel */}
            <div className={`col-span-1 rounded-xl border p-4 ${status === 'STOP_LOSS_HIT' ? 'bg-red-500/10 border-red-500/30' :
                status === 'TARGET_HIT' ? 'bg-emerald-500/10 border-emerald-500/30' :
                  'bg-blue-500/10 border-blue-500/30'
              }`}>
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Status</div>
              <div className="flex items-center gap-2 mb-2">
                {status === 'STOP_LOSS_HIT' ? <ShieldAlert className="text-red-400 w-5 h-5" /> :
                  status === 'TARGET_HIT' ? <CheckCircle2 className="text-emerald-400 w-5 h-5" /> :
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />}
                <span className={`text-lg font-bold ${status === 'STOP_LOSS_HIT' ? 'text-red-400' :
                    status === 'TARGET_HIT' ? 'text-emerald-400' : 'text-blue-400'
                  }`}>
                  {status === 'STOP_LOSS_HIT' ? 'STOP LOSS HIT' :
                    status === 'TARGET_HIT' ? 'TARGET ACHIEVED' :
                      'LIVE TRACKING'}
                </span>
              </div>
              <div className="text-sm text-zinc-300">Strike: <span className="font-mono font-bold">{trackedStrike}</span></div>
              <div className="text-sm text-zinc-300">Started: {entryTime}</div>
            </div>

            {/* Strategy Logic Panel */}
            <div className="col-span-1 md:col-span-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4">
              {strategyType === 'INDIVIDUAL_LEG_PERCENT' ? (
                <div className="grid grid-cols-2 gap-4">
                  {/* CE Side */}
                  <div className={`p-3 rounded-lg border ${ceStatus === 'SL_HIT' ? 'bg-red-500/5 border-red-500/20' : 'bg-zinc-800/20 border-zinc-700/50'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-zinc-400">CALL (CE) LEG</span>
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${ceStatus === 'SL_HIT' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        {ceStatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-xs text-zinc-500">Entry: {entryCE}</div>
                        <div className="text-xs text-zinc-500 mt-1">SL Level: {(entryCE * (1 + stopLoss / 100)).toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-zinc-500 uppercase">Current</div>
                        <div className={`text-xl font-mono ${ceStatus === 'SL_HIT' ? 'text-red-400' : 'text-white'}`}>
                          {activeCEPrice.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* PE Side */}
                  <div className={`p-3 rounded-lg border ${peStatus === 'SL_HIT' ? 'bg-red-500/5 border-red-500/20' : 'bg-zinc-800/20 border-zinc-700/50'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-zinc-400">PUT (PE) LEG</span>
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${peStatus === 'SL_HIT' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        {peStatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-xs text-zinc-500">Entry: {entryPE}</div>
                        <div className="text-xs text-zinc-500 mt-1">SL Level: {(entryPE * (1 + stopLoss / 100)).toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-zinc-500 uppercase">Current</div>
                        <div className={`text-xl font-mono ${peStatus === 'SL_HIT' ? 'text-red-400' : 'text-white'}`}>
                          {activePEPrice.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4 text-center h-full items-center">
                  <div>
                    <div className="text-xs text-zinc-500 uppercase">Entry Premium</div>
                    <div className="text-2xl font-mono text-zinc-300 mt-1">{entryPremium.toFixed(2)}</div>
                    <div className="text-xs text-zinc-500 mt-1">CE {entryCE} + PE {entryPE}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 uppercase">Current Premium</div>
                    <div className="text-2xl font-mono text-white mt-1">{currentPremium.toFixed(2)}</div>
                    <div className="text-xs text-zinc-500 mt-1">CE {currentCE} + PE {currentPE}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 uppercase">Trailing SL</div>
                    <div className="text-2xl font-mono text-orange-400 mt-1">{currentSL.toFixed(2)}</div>
                    <div className="text-xs text-orange-400/60 mt-1">Base: {basePremium.toFixed(2)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* PnL Panel */}
            <div className="col-span-1 rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-4 flex flex-col items-center justify-center">
              <div className="text-xs text-zinc-500 uppercase mb-2">Simulated live P&L</div>
              <div className={`text-3xl font-mono font-bold ${currentMtm >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {currentMtm >= 0 ? '+' : ''}₹{currentMtm.toFixed(2)}
              </div>
              <div className={`text-sm font-mono mt-1 ${currentPointsGain >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                {currentPointsGain >= 0 ? '+' : ''}{currentPointsGain.toFixed(2)} pts
              </div>
              {targetProfit > 0 && (
                <div className="text-[10px] text-zinc-500 mt-3 border-t border-zinc-800 pt-2 w-full text-center">
                  Target: ₹{targetProfit}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
