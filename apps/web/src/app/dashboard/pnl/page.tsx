'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SimulationResultModal, { SimulationResult } from '@/components/SimulationResultModal';

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

interface SimulationStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  avgPnLPercent: number;
  avgDaysHeld: number;
  avgRMultiple: number;
  bestTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
  worstTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
  totalCapitalDeployed: number;
  profitFactor: number;
}

interface SimulatedTrade {
  id: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPercent: number;
  daysHeld: number;
  entryDate: string;
  exitDate: string;
  exitReason: string;
  capitalDeployed: number;
  rMultiple: number;
  createdAt: string;
  highestPrice?: number;
  initialStopPrice?: number;
  events?: Array<{ day: number; date: string; type: string; price: number; stopPrice: number; note?: string }>;
  dailyData?: Array<{ date: string; open: number; high: number; low: number; close: number; stopPrice: number }>;
}

export default function PnLPage() {
  const token = useAuthStore((state) => state.token);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pnl, setPnl] = useState({ daily: 0, weekly: 0, monthly: 0 });
  const [simStats, setSimStats] = useState<SimulationStats | null>(null);
  const [simTrades, setSimTrades] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'live' | 'simulation'>('simulation');
  const [dailyTotalsOpen, setDailyTotalsOpen] = useState(false);
  const [selectedSimulation, setSelectedSimulation] = useState<SimulationResult | null>(null);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [dashboardData, activityData, simulationStats, simulationHistory] = await Promise.all([
        api.getDashboard(token),
        api.getActivityLog(token, 100),
        api.getSimulationStats(token),
        api.getSimulationHistory(token, 100),
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
      setSimStats(simulationStats);
      setSimTrades(simulationHistory);
    } catch {
      // Silently handle errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleClearSimulations = async () => {
    if (!token) return;
    if (!confirm('Clear all simulation history? This cannot be undone.')) return;
    try {
      await api.clearSimulationHistory(token);
      fetchData();
    } catch {
      // Silently handle errors
    }
  };

  const liveWinRate = trades.length > 0
    ? (trades.filter(t => Number(t.pnl) > 0).length / trades.length) * 100
    : 0;

  // Group simulated trades by entry date for daily totals
  const dailyTotals = simTrades.reduce((acc, trade) => {
    const date = new Date(trade.entryDate).toLocaleDateString();
    if (!acc[date]) {
      acc[date] = { pnl: 0, trades: 0, capital: 0 };
    }
    acc[date].pnl += Number(trade.pnl);
    acc[date].trades += 1;
    acc[date].capital += Number(trade.capitalDeployed);
    return acc;
  }, {} as Record<string, { pnl: number; trades: number; capital: number }>);

  const sortedDailyTotals = Object.entries(dailyTotals)
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());

  const handleTradeClick = (trade: SimulatedTrade) => {
    const result: SimulationResult = {
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      entryPrice: Number(trade.entryPrice),
      exitDate: trade.exitDate,
      exitPrice: Number(trade.exitPrice),
      exitReason: trade.exitReason,
      shares: trade.shares,
      daysHeld: trade.daysHeld,
      pnl: Number(trade.pnl),
      pnlPercent: Number(trade.pnlPercent),
      highestPrice: Number(trade.highestPrice) || Number(trade.exitPrice),
      events: trade.events || [],
      dailyData: trade.dailyData || [],
    };
    setSelectedSimulation(result);
  };

  if (loading) return <div className="text-gray-400">Loading...</div>;

  const PnLCard = ({ label, value, subtext }: { label: string; value: number | string; subtext?: string }) => (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className={`text-2xl font-bold ${typeof value === 'number' ? (value >= 0 ? 'text-green-500' : 'text-red-500') : 'text-white'}`}>
        {typeof value === 'number' ? `${value >= 0 ? '+' : ''}$${value.toFixed(2)}` : value}
      </div>
      {subtext && <div className="text-gray-500 text-xs mt-1">{subtext}</div>}
    </div>
  );

  const StatCard = ({ label, value, color = 'white' }: { label: string; value: string; color?: string }) => (
    <div className="bg-gray-800 p-3 rounded-lg">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`text-lg font-bold text-${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">P&L</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('simulation')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'simulation' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            Simulation
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'live' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            Live Trades
          </button>
        </div>
      </div>

      {activeTab === 'simulation' ? (
        <>
          {/* Simulation Stats */}
          {simStats && simStats.totalTrades > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg">
                  <div className="text-gray-400 text-sm">Capital Deployed</div>
                  <div className="text-2xl font-bold text-white">
                    ${(simStats.totalCapitalDeployed ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-gray-500 text-xs mt-1">{simStats.totalTrades} trades</div>
                </div>
                <PnLCard label="Total P&L" value={simStats.totalPnL} subtext={`${(((simStats.totalPnL ?? 0) / (simStats.totalCapitalDeployed || 1)) * 100).toFixed(2)}% ROI`} />
                <div className="bg-gray-800 p-4 rounded-lg">
                  <div className="text-gray-400 text-sm">Win Rate</div>
                  <div className={`text-2xl font-bold ${(simStats.winRate ?? 0) >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
                    {(simStats.winRate ?? 0).toFixed(1)}%
                  </div>
                  <div className="text-gray-500 text-xs mt-1">{simStats.winningTrades ?? 0}W / {simStats.losingTrades ?? 0}L</div>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg">
                  <div className="text-gray-400 text-sm">Avg R-Multiple</div>
                  <div className={`text-2xl font-bold ${(simStats.avgRMultiple ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {(simStats.avgRMultiple ?? 0) >= 0 ? '+' : ''}{(simStats.avgRMultiple ?? 0).toFixed(2)}R
                  </div>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg">
                  <div className="text-gray-400 text-sm">Profit Factor</div>
                  <div className={`text-2xl font-bold ${(simStats.profitFactor ?? 0) >= 1 ? 'text-green-500' : 'text-red-500'}`}>
                    {simStats.profitFactor === Infinity ? '∞' : (simStats.profitFactor ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Avg P&L" value={`${(simStats.avgPnL ?? 0) >= 0 ? '+' : ''}$${(simStats.avgPnL ?? 0).toFixed(2)}`} color={(simStats.avgPnL ?? 0) >= 0 ? 'green-400' : 'red-400'} />
                <StatCard label="Avg Return" value={`${(simStats.avgPnLPercent ?? 0) >= 0 ? '+' : ''}${(simStats.avgPnLPercent ?? 0).toFixed(2)}%`} color={(simStats.avgPnLPercent ?? 0) >= 0 ? 'green-400' : 'red-400'} />
                <StatCard label="Avg Days Held" value={(simStats.avgDaysHeld ?? 0).toFixed(1)} />
                <StatCard label="Avg Capital/Trade" value={`$${((simStats.totalCapitalDeployed ?? 0) / (simStats.totalTrades || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              </div>

              {simStats.bestTrade && simStats.worstTrade && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-500/20 border border-green-500 p-4 rounded-lg">
                    <div className="text-gray-400 text-sm">Best Trade</div>
                    <div className="text-green-400 font-bold">{simStats.bestTrade.symbol}</div>
                    <div className="text-green-400 text-xl font-mono">+${simStats.bestTrade.pnl.toFixed(2)} (+{simStats.bestTrade.pnlPercent.toFixed(2)}%)</div>
                  </div>
                  <div className="bg-red-500/20 border border-red-500 p-4 rounded-lg">
                    <div className="text-gray-400 text-sm">Worst Trade</div>
                    <div className="text-red-400 font-bold">{simStats.worstTrade.symbol}</div>
                    <div className="text-red-400 text-xl font-mono">${simStats.worstTrade.pnl.toFixed(2)} ({simStats.worstTrade.pnlPercent.toFixed(2)}%)</div>
                  </div>
                </div>
              )}

              {/* Daily Totals */}
              {sortedDailyTotals.length > 0 && (
                <div className="bg-gray-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setDailyTotalsOpen(!dailyTotalsOpen)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/30"
                  >
                    <div>
                      <span className="font-semibold text-white">Daily Totals</span>
                      <span className="text-gray-400 ml-2">(by entry date)</span>
                    </div>
                    <span className="text-gray-400 text-xl">{dailyTotalsOpen ? '−' : '+'}</span>
                  </button>
                  {dailyTotalsOpen && (
                    <div className="divide-y divide-gray-700/50 border-t border-gray-700">
                      {sortedDailyTotals.map(([date, data]) => (
                        <div key={date} className="px-4 py-3 flex items-center justify-between hover:bg-gray-700/30">
                          <div>
                            <div className="text-white font-medium">{date}</div>
                            <div className="text-gray-500 text-xs">{data.trades} trade{data.trades !== 1 ? 's' : ''} · ${data.capital.toLocaleString(undefined, { maximumFractionDigits: 0 })} deployed</div>
                          </div>
                          <div className={`text-xl font-bold font-mono ${data.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="bg-gray-800 p-8 rounded-lg text-center text-gray-400">
              No simulation data yet. Run simulations from the Opportunities page.
            </div>
          )}

          {/* Simulation Trade History */}
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex justify-between items-center">
              <div>
                <span className="font-semibold text-white">Simulated Trades</span>
                <span className="text-gray-400 ml-2">({simTrades.length})</span>
              </div>
              {simTrades.length > 0 && (
                <button
                  onClick={handleClearSimulations}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Clear All
                </button>
              )}
            </div>

            {simTrades.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                No simulated trades yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-gray-400 text-sm border-b border-gray-700">
                      <th className="text-left py-2 px-4">Symbol</th>
                      <th className="text-left py-2 px-4">Entry</th>
                      <th className="text-left py-2 px-4">Exit</th>
                      <th className="text-right py-2 px-4">Capital</th>
                      <th className="text-right py-2 px-4">Days</th>
                      <th className="text-right py-2 px-4">P&L</th>
                      <th className="text-right py-2 px-4">Return</th>
                      <th className="text-right py-2 px-4">R-Mult</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simTrades.map((trade) => (
                      <tr
                        key={trade.id}
                        className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                        onClick={() => handleTradeClick(trade)}
                      >
                        <td className="py-3 px-4 text-white font-medium">{trade.symbol}</td>
                        <td className="py-3 px-4 text-gray-400 text-sm">
                          ${Number(trade.entryPrice).toFixed(2)}
                          <div className="text-xs text-gray-500">{new Date(trade.entryDate).toLocaleDateString()}</div>
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-sm">
                          ${Number(trade.exitPrice).toFixed(2)}
                          <div className="text-xs text-gray-500">{new Date(trade.exitDate).toLocaleDateString()}</div>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-300">
                          ${Number(trade.capitalDeployed).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-300">{trade.daysHeld}</td>
                        <td className={`py-3 px-4 text-right font-medium ${Number(trade.pnl) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {Number(trade.pnl) >= 0 ? '+' : ''}${Number(trade.pnl).toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-right ${Number(trade.pnlPercent) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {Number(trade.pnlPercent) >= 0 ? '+' : ''}{Number(trade.pnlPercent).toFixed(2)}%
                        </td>
                        <td className={`py-3 px-4 text-right font-mono ${Number(trade.rMultiple) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {Number(trade.rMultiple) >= 0 ? '+' : ''}{Number(trade.rMultiple).toFixed(2)}R
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Live Trading Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <PnLCard label="Daily" value={pnl.daily} />
            <PnLCard label="Weekly" value={pnl.weekly} />
            <PnLCard label="Monthly" value={pnl.monthly} />
            <div className="bg-gray-800 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Win Rate</div>
              <div className={`text-2xl font-bold ${liveWinRate >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
                {liveWinRate.toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Live Trade History */}
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <span className="font-semibold text-white">Live Trade History</span>
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
        </>
      )}

      {/* Simulation Result Modal */}
      {selectedSimulation && (
        <SimulationResultModal
          result={selectedSimulation}
          onClose={() => setSelectedSimulation(null)}
        />
      )}
    </div>
  );
}
