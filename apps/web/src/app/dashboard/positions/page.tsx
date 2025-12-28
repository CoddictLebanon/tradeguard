'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface PositionRaw {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number | null;
  highestPrice?: number | null;
  highWaterMark?: number | null;
  trailPercent: number;
  stopPrice?: number;
  status: string;
  openedAt: string;
}

interface Position extends Omit<PositionRaw, 'currentPrice'> {
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

export default function PositionsPage() {
  const token = useAuthStore((state) => state.token);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = async () => {
    if (!token) return;
    try {
      const data: PositionRaw[] = await api.getPositions(token);
      // Calculate P&L for each position
      const enrichedPositions: Position[] = data.map((pos) => {
        const current = Number(pos.currentPrice) || Number(pos.entryPrice);
        const entry = Number(pos.entryPrice);
        const shares = Number(pos.shares);
        const unrealizedPnl = (current - entry) * shares;
        const unrealizedPnlPercent = entry > 0 ? ((current - entry) / entry) * 100 : 0;
        return {
          ...pos,
          currentPrice: current,
          unrealizedPnl,
          unrealizedPnlPercent,
        };
      });
      setPositions(enrichedPositions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [token]);

  const handleClose = async (id: string) => {
    if (!token || !confirm('Close this position?')) return;
    try {
      await api.closePosition(token, id);
      await fetchPositions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close position');
    }
  };

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>
          <span className="text-2xl font-bold text-white">Positions</span>
          <span className="ml-2 text-gray-400">({positions.length})</span>
        </h1>
        <div className={`text-xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          Total: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded">
          {error}
        </div>
      )}

      {positions.length === 0 ? (
        <div className="bg-gray-800 p-8 rounded-lg text-center text-gray-400">
          No open positions. Approve an opportunity to open a position.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Symbol</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Shares</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Capital</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Entry</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Current</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Stop</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Stop %</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">P/L</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const capital = pos.shares * Number(pos.entryPrice);
                const stopPct = ((Number(pos.entryPrice) - Number(pos.stopPrice)) / Number(pos.entryPrice)) * 100;
                return (
                  <tr key={pos.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-4 px-4 font-medium text-white">{pos.symbol}</td>
                    <td className="py-4 px-4 text-right text-gray-300">{pos.shares}</td>
                    <td className="py-4 px-4 text-right text-blue-400 font-medium">${capital.toLocaleString()}</td>
                    <td className="py-4 px-4 text-right text-gray-300">${Number(pos.entryPrice).toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-gray-300">${pos.currentPrice.toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-red-400">${Number(pos.stopPrice).toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-yellow-400">{stopPct.toFixed(2)}%</td>
                    <td className={`py-4 px-4 text-right font-medium ${pos.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      <span className="text-xs ml-1">({pos.unrealizedPnlPercent.toFixed(1)}%)</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => handleClose(pos.id)}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded"
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
