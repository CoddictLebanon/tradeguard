'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Position {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  stopPrice: number;
  status: string;
}

interface PositionsTableProps {
  positions: Position[];
}

type SortKey = 'symbol' | 'pnl' | 'pnlPercent' | 'stopPercent';
type SortDir = 'asc' | 'desc';

export function PositionsTable({ positions }: PositionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('pnlPercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedPositions = [...positions].sort((a, b) => {
    const aPnl = (a.currentPrice - a.entryPrice) * a.shares;
    const bPnl = (b.currentPrice - b.entryPrice) * b.shares;
    const aPnlPct = ((a.currentPrice - a.entryPrice) / a.entryPrice) * 100;
    const bPnlPct = ((b.currentPrice - b.entryPrice) / b.entryPrice) * 100;
    const aStopPct = ((a.currentPrice - a.stopPrice) / a.currentPrice) * 100;
    const bStopPct = ((b.currentPrice - b.stopPrice) / b.currentPrice) * 100;

    let comparison = 0;
    switch (sortKey) {
      case 'symbol':
        comparison = a.symbol.localeCompare(b.symbol);
        break;
      case 'pnl':
        comparison = aPnl - bPnl;
        break;
      case 'pnlPercent':
        comparison = aPnlPct - bPnlPct;
        break;
      case 'stopPercent':
        comparison = aStopPct - bStopPct;
        break;
    }
    return sortDir === 'asc' ? comparison : -comparison;
  });

  const formatCurrency = (value: number) => {
    const formatted = Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return value >= 0 ? `$${formatted}` : `-$${formatted}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <th
      className="text-left py-3 px-4 text-gray-400 font-medium text-sm cursor-pointer hover:text-white transition-colors"
      onClick={() => handleSort(sortKeyName)}
    >
      {label}
      {sortKey === sortKeyName && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  if (positions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-medium">Open Positions</h3>
          <span className="bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-full">0</span>
        </div>
        <p className="text-gray-500 text-center py-8">No open positions</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h3 className="text-white font-medium">Open Positions</h3>
        <div className="flex items-center gap-3">
          <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
            {positions.length}
          </span>
          <Link
            href="/dashboard/positions"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            View All →
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-900/50">
            <tr>
              <SortHeader label="Symbol" sortKeyName="symbol" />
              <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Shares</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Entry</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Current</th>
              <SortHeader label="P&L" sortKeyName="pnl" />
              <SortHeader label="P&L %" sortKeyName="pnlPercent" />
              <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Stop</th>
              <SortHeader label="Stop %" sortKeyName="stopPercent" />
            </tr>
          </thead>
          <tbody>
            {sortedPositions.map((position, index) => {
              const pnl = (position.currentPrice - position.entryPrice) * position.shares;
              const pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
              const stopPercent = ((position.currentPrice - position.stopPrice) / position.currentPrice) * 100;
              const isPositive = pnl >= 0;

              return (
                <tr
                  key={position.id}
                  className={`border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30 transition-colors ${
                    index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50'
                  }`}
                >
                  <td className="py-3 px-4">
                    <Link
                      href={`/dashboard/positions?highlight=${position.id}`}
                      className="text-white font-medium hover:text-blue-400 transition-colors"
                    >
                      {position.symbol}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{position.shares}</td>
                  <td className="py-3 px-4 text-gray-300">${position.entryPrice.toFixed(2)}</td>
                  <td className="py-3 px-4 text-white">${position.currentPrice.toFixed(2)}</td>
                  <td className={`py-3 px-4 font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(pnl)}
                  </td>
                  <td className={`py-3 px-4 font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(pnlPercent)}
                  </td>
                  <td className="py-3 px-4 text-gray-300">${position.stopPrice.toFixed(2)}</td>
                  <td className="py-3 px-4 text-yellow-400">{stopPercent.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
