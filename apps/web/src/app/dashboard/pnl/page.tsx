'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Trade {
  id: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPercent: number;
  closedAt: string;
}

export default function PnLPage() {
  const token = useAuthStore((state) => state.token);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pnl, setPnl] = useState({ daily: 0, weekly: 0, monthly: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;
      try {
        const [dashboardData, activityData] = await Promise.all([
          api.getDashboard(token),
          api.getActivityLog(token, 100),
        ]);

        setPnl({
          daily: dashboardData.state.dailyPnL || 0,
          weekly: dashboardData.state.weeklyPnL || 0,
          monthly: dashboardData.state.monthlyPnL || 0,
        });

        const closedTrades = activityData
          .filter((a: { type: string }) => a.type === 'POSITION_CLOSED')
          .map((a: { details: Record<string, unknown>; createdAt: string }) => ({
            id: String(a.details.id || ''),
            symbol: String(a.details.symbol || ''),
            entryPrice: Number(a.details.entryPrice) || 0,
            exitPrice: Number(a.details.exitPrice) || 0,
            shares: Number(a.details.shares) || 0,
            pnl: Number(a.details.pnl) || 0,
            pnlPercent: Number(a.details.pnlPercent) || 0,
            closedAt: a.createdAt,
          }));
        setTrades(closedTrades);
      } catch {
        // Silently handle errors
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [token]);

  const totalPnL = trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const winRate = trades.length > 0
    ? (trades.filter(t => Number(t.pnl) > 0).length / trades.length) * 100
    : 0;

  if (loading) return <div className="text-gray-400">Loading...</div>;

  const PnLCard = ({ label, value }: { label: string; value: number }) => (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className={`text-2xl font-bold ${value >= 0 ? 'text-green-500' : 'text-red-500'}`}>
        {value >= 0 ? '+' : ''}${value.toFixed(2)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">P&L</h1>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <PnLCard label="Daily" value={pnl.daily} />
        <PnLCard label="Weekly" value={pnl.weekly} />
        <PnLCard label="Monthly" value={pnl.monthly} />
        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-gray-400 text-sm">Win Rate</div>
          <div className={`text-2xl font-bold ${winRate >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
            {winRate.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Trade History */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <span className="font-semibold text-white">Trade History</span>
          <span className="text-gray-400 ml-2">({trades.length})</span>
        </div>

        {trades.length === 0 ? (
          <div className="text-gray-400 text-center py-8">
            No closed trades yet
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-gray-400 text-sm border-b border-gray-700">
                <th className="text-left py-2 px-4">Date</th>
                <th className="text-left py-2 px-4">Symbol</th>
                <th className="text-right py-2 px-4">Entry</th>
                <th className="text-right py-2 px-4">Exit</th>
                <th className="text-right py-2 px-4">P&L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, idx) => (
                <tr key={trade.id || idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(trade.closedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-white font-medium">{trade.symbol}</td>
                  <td className="py-3 px-4 text-right text-gray-300">
                    ${Number(trade.entryPrice).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-300">
                    ${Number(trade.exitPrice).toFixed(2)}
                  </td>
                  <td className={`py-3 px-4 text-right font-medium ${Number(trade.pnl) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {Number(trade.pnl) >= 0 ? '+' : ''}${Number(trade.pnl).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
