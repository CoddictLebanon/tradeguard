'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface DashboardData {
  state: {
    mode: 'paper' | 'live';
    isPaused: boolean;
    pauseReason: string | null;
    dailyPnL: number;
    weeklyPnL: number;
    monthlyPnL: number;
    consecutiveLosses: number;
    openPositionsCount: number;
    capitalDeployed: number;
  };
  limits: {
    dailyLossLimitPercent: number;
    weeklyLossLimitPercent: number;
    monthlyLossLimitPercent: number;
    maxOpenPositions: number;
    maxCapitalDeployedPercent: number;
  };
  tradingMode: 'paper' | 'live';
  canTrade: boolean;
}

export default function DashboardPage() {
  const token = useAuthStore((state) => state.token);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        const result = await api.getDashboard(token);
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [token]);

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { state: tradingState, limits, canTrade } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Status Banner */}
      {tradingState.isPaused && (
        <div className="bg-red-500/20 border border-red-500 p-4 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-red-500 font-bold">⚠ TRADING PAUSED</span>
            <span className="text-red-400">{tradingState.pauseReason}</span>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Mode */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Trading Mode</div>
          <div className={`mt-2 text-2xl font-bold uppercase ${
            tradingState.mode === 'paper' ? 'text-yellow-500' : 'text-green-500'
          }`}>
            {tradingState.mode}
          </div>
        </div>

        {/* Can Trade */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Trading Status</div>
          <div className={`mt-2 text-2xl font-bold ${
            canTrade ? 'text-green-500' : 'text-red-500'
          }`}>
            {canTrade ? 'Ready' : 'Blocked'}
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Open Positions</div>
          <div className="mt-2 text-2xl font-bold text-white">
            {tradingState.openPositionsCount} / {limits.maxOpenPositions}
          </div>
        </div>

        {/* Consecutive Losses */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Consecutive Losses</div>
          <div className={`mt-2 text-2xl font-bold ${
            tradingState.consecutiveLosses >= 3 ? 'text-red-500' : 'text-white'
          }`}>
            {tradingState.consecutiveLosses}
          </div>
        </div>
      </div>

      {/* P/L Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Daily P/L</div>
          <div className={`mt-2 text-3xl font-bold ${
            tradingState.dailyPnL >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            {tradingState.dailyPnL >= 0 ? '+' : ''}${tradingState.dailyPnL.toFixed(2)}
          </div>
          <div className="mt-2 text-gray-500 text-sm">
            Limit: -{limits.dailyLossLimitPercent}%
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Weekly P/L</div>
          <div className={`mt-2 text-3xl font-bold ${
            tradingState.weeklyPnL >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            {tradingState.weeklyPnL >= 0 ? '+' : ''}${tradingState.weeklyPnL.toFixed(2)}
          </div>
          <div className="mt-2 text-gray-500 text-sm">
            Limit: -{limits.weeklyLossLimitPercent}%
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm">Monthly P/L</div>
          <div className={`mt-2 text-3xl font-bold ${
            tradingState.monthlyPnL >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            {tradingState.monthlyPnL >= 0 ? '+' : ''}${tradingState.monthlyPnL.toFixed(2)}
          </div>
          <div className="mt-2 text-gray-500 text-sm">
            Limit: -{limits.monthlyLossLimitPercent}%
          </div>
        </div>
      </div>

      {/* Capital Deployed */}
      <div className="bg-gray-800 p-6 rounded-lg">
        <div className="text-gray-400 text-sm">Capital Deployed</div>
        <div className="mt-2 text-2xl font-bold text-white">
          ${tradingState.capitalDeployed.toLocaleString()}
        </div>
        <div className="mt-2 text-gray-500 text-sm">
          Max: {limits.maxCapitalDeployedPercent}% of portfolio
        </div>
      </div>
    </div>
  );
}
