'use client';

import { useMemo } from 'react';
import { blackScholesGreeks } from '@/lib/greeks';

interface OptionData {
  strikePrice: number;
  expiryDate: string;
  CE?: {
    openInterest: number;
    changeinOpenInterest: number;
    totalTradedVolume: number;
    lastPrice: number;
    impliedVolatility: number;
  };
  PE?: {
    openInterest: number;
    changeinOpenInterest: number;
    totalTradedVolume: number;
    lastPrice: number;
    impliedVolatility: number;
  };
}

interface OptionChainTableProps {
  data: OptionData[];
  timestamp?: string;
  underlyingValue?: number;
}

const formatNumber = (value: number | undefined) => {
  if (value === undefined || value === null) return '-';
  return value.toLocaleString('en-IN');
};

const formatChange = (value: number | undefined) => {
  if (value === undefined || value === null) return '-';
  const formatted = value.toLocaleString('en-IN');
  if (value > 0) return <span className="text-green-400">+{formatted}</span>;
  if (value < 0) return <span className="text-red-400">{formatted}</span>;
  return <span className="text-zinc-500">{formatted}</span>;
};

export default function OptionChainTable({ data, timestamp, underlyingValue }: OptionChainTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-400">
        <p className="text-lg">No option chain data available.</p>
        <p className="text-sm mt-1">Select a symbol and expiry date above.</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => a.strikePrice - b.strikePrice);

  return (
    <div className="mt-6">
      {timestamp && (
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm text-zinc-400">
            Last Updated: <span className="text-zinc-200 font-medium">{timestamp}</span>
          </p>
          {underlyingValue ? (
            <p className="text-sm text-zinc-400">
              Spot Price: <span className="text-blue-400 font-mono font-bold">{underlyingValue.toLocaleString('en-IN')}</span>
            </p>
          ) : null}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700/50">
              <th colSpan={9} className="px-2 py-3 text-center text-red-400 font-semibold bg-red-500/5 text-xs uppercase tracking-wider border-r border-zinc-700/50">
                Calls
              </th>
              <th className="px-2 py-3 text-center bg-zinc-800/60 font-bold text-zinc-200 text-base border-r border-zinc-700/50">
                Strike
              </th>
              <th colSpan={9} className="px-2 py-3 text-center text-green-400 font-semibold bg-green-500/5 text-xs uppercase tracking-wider">
                Puts
              </th>
            </tr>
            <tr className="border-b border-zinc-700/50 text-zinc-400 text-xs uppercase tracking-wider">
              {/* Calls Headers */}
              <th className="px-2 py-2 text-right bg-red-500/5">OI</th>
              <th className="px-2 py-2 text-right bg-red-500/5">Chg OI</th>
              <th className="px-2 py-2 text-right bg-red-500/5">Vol</th>
              <th className="px-2 py-2 text-right bg-red-500/5">IV</th>
              <th className="px-2 py-2 text-right bg-zinc-900">Vega</th>
              <th className="px-2 py-2 text-right bg-zinc-900">Theta</th>
              <th className="px-2 py-2 text-right bg-zinc-900">Gamma</th>
              <th className="px-2 py-2 text-right bg-zinc-900 text-indigo-400">Delta</th>
              <th className="px-2 py-2 text-right bg-red-500/10 font-bold border-r border-zinc-700/50">LTP</th>

              {/* Strike Header */}
              <th className="px-2 py-2 text-center bg-zinc-800/60 border-r border-zinc-700/50"></th>

              {/* Puts Headers */}
              <th className="px-2 py-2 text-left bg-green-500/10 font-bold">LTP</th>
              <th className="px-2 py-2 text-left bg-zinc-900 text-indigo-400">Delta</th>
              <th className="px-2 py-2 text-left bg-zinc-900">Gamma</th>
              <th className="px-2 py-2 text-left bg-zinc-900">Theta</th>
              <th className="px-2 py-2 text-left bg-zinc-900">Vega</th>
              <th className="px-2 py-2 text-left bg-green-500/5">IV</th>
              <th className="px-2 py-2 text-left bg-green-500/5">Vol</th>
              <th className="px-2 py-2 text-left bg-green-500/5">Chg OI</th>
              <th className="px-2 py-2 text-left bg-green-500/5">OI</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              // Calculate Time to Expiry (T) in years
              let T = 0;
              if (item.expiryDate) {
                const expDate = new Date(item.expiryDate);
                const now = new Date();
                // Set explicitly to India timezone equivalent if desired, or just approximate days
                const diffMs = expDate.getTime() - now.getTime();
                const daysToExpiry = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
                T = daysToExpiry / 365.0;
              }

              // Constants for Risk-Free Rate
              const r = 0.10; // 10% defaults from backend

              // Calculate CE Greeks
              let ceDelta = 0, ceGamma = 0, ceTheta = 0, ceVega = 0;
              if (underlyingValue && item.CE?.impliedVolatility) {
                const sigma = item.CE.impliedVolatility / 100.0;
                const greeks = blackScholesGreeks(underlyingValue, item.strikePrice, T, r, sigma, true);
                ceDelta = greeks.delta;
                ceGamma = greeks.gamma;
                ceTheta = greeks.theta;
                ceVega = greeks.vega;
              }

              // Calculate PE Greeks
              let peDelta = 0, peGamma = 0, peTheta = 0, peVega = 0;
              if (underlyingValue && item.PE?.impliedVolatility) {
                const sigma = item.PE.impliedVolatility / 100.0;
                const greeks = blackScholesGreeks(underlyingValue, item.strikePrice, T, r, sigma, false);
                peDelta = greeks.delta;
                peGamma = greeks.gamma;
                peTheta = greeks.theta;
                peVega = greeks.vega;
              }

              return (
                <tr
                  key={item.strikePrice}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors whitespace-nowrap"
                >
                  <td className="px-2 py-2 text-right font-mono text-zinc-400 bg-red-500/[0.02]">
                    {formatNumber(item.CE?.openInterest)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono bg-red-500/[0.02]">
                    {formatChange(item.CE?.changeinOpenInterest)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-400 bg-red-500/[0.02]">
                    {formatNumber(item.CE?.totalTradedVolume)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-amber-500/80 bg-red-500/[0.02]">
                    {item.CE?.impliedVolatility?.toFixed(1) ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-500 text-xs bg-zinc-900">
                    {ceVega === 0 ? '-' : ceVega.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-500 text-xs bg-zinc-900">
                    {ceTheta === 0 ? '-' : ceTheta.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-500 text-xs bg-zinc-900">
                    {ceGamma === 0 ? '-' : ceGamma.toFixed(4)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-indigo-400 bg-zinc-900">
                    {ceDelta === 0 ? '-' : ceDelta.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-200 bg-red-500/10 border-r border-zinc-700/50 font-bold">
                    {item.CE?.lastPrice?.toFixed(2) ?? '-'}
                  </td>

                  <td className="px-2 py-2 text-center font-bold text-zinc-100 bg-zinc-800/60 text-base border-r border-zinc-700/50">
                    {item.strikePrice}
                  </td>

                  <td className="px-2 py-2 text-left font-mono text-zinc-200 bg-green-500/10 font-bold">
                    {item.PE?.lastPrice?.toFixed(2) ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-indigo-400 bg-zinc-900">
                    {peDelta === 0 ? '-' : peDelta.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-zinc-500 text-xs bg-zinc-900">
                    {peGamma === 0 ? '-' : peGamma.toFixed(4)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-zinc-500 text-xs bg-zinc-900">
                    {peTheta === 0 ? '-' : peTheta.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-zinc-500 text-xs bg-zinc-900">
                    {peVega === 0 ? '-' : peVega.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-amber-500/80 bg-green-500/[0.02]">
                    {item.PE?.impliedVolatility?.toFixed(1) ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-zinc-400 bg-green-500/[0.02]">
                    {formatNumber(item.PE?.totalTradedVolume)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono bg-green-500/[0.02]">
                    {formatChange(item.PE?.changeinOpenInterest)}
                  </td>
                  <td className="px-2 py-2 text-left font-mono text-zinc-400 bg-green-500/[0.02]">
                    {formatNumber(item.PE?.openInterest)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
