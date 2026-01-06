'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { SystemHealth } from '@/components/SystemHealth';

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

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const percent = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-500`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  icon,
  color = 'text-white',
  bgColor = 'bg-gray-800'
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: string;
  color?: string;
  bgColor?: string;
}) {
  return (
    <div className={`${bgColor} rounded-xl p-5 border border-gray-700/50`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm font-medium">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
        </div>
        <span className="text-2xl opacity-60">{icon}</span>
      </div>
    </div>
  );
}

function PnLCard({
  period,
  value,
  limitPercent
}: {
  period: string;
  value: number;
  limitPercent: number;
}) {
  const isPositive = value >= 0;
  const color = isPositive ? 'text-green-400' : 'text-red-400';
  const barColor = isPositive ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm font-medium">{period} P&L</span>
        <span className="text-gray-500 text-xs">Limit: -{limitPercent}%</span>
      </div>
      <p className={`text-3xl font-bold ${color}`}>
        {isPositive ? '+' : ''}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <div className="mt-3">
        <ProgressBar value={value} max={1000} color={barColor} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const token = useAuthStore((state) => state.token);
  const [data, setData] = useState<DashboardData | null>(null);
  const [totalCapital, setTotalCapital] = useState<number>(100000); // Default fallback
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState<Array<{
    id: string;
    timestamp: string;
    type: string;
    symbol: string | null;
    message: string;
    details: { pnl?: number };
    positionId: string | null;
  }> | null>(null);

  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        const [dashboardResult, configResult] = await Promise.all([
          api.getDashboard(token),
          api.getAccountConfig(token).catch(() => null),
        ]);
        setData(dashboardResult);
        if (configResult?.account?.totalCapital) {
          setTotalCapital(configResult.account.totalCapital);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }

      // Fetch recent activity
      api.getActivityFeed(token, { limit: 10 }).then((res) => setRecentActivity(res.items)).catch(() => {});
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-6 rounded-xl">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚠</span>
          <div>
            <p className="font-medium">Failed to load dashboard</p>
            <p className="text-sm text-red-400/70 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { state: tradingState, limits, canTrade } = data;
  const capitalPercent = (tradingState.capitalDeployed / totalCapital) * 100;

  function getRelativeTime(timestamp: string): string {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    return `${diffDays}d ago`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Real-time trading overview</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            tradingState.mode === 'paper'
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              : 'bg-green-500/20 text-green-400 border border-green-500/30'
          }`}>
            {tradingState.mode.toUpperCase()} MODE
          </span>
        </div>
      </div>

      {/* Alert Banner */}
      {tradingState.isPaused && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
            <span className="text-red-500 text-xl">⚠</span>
          </div>
          <div>
            <p className="text-red-400 font-semibold">Trading Paused</p>
            <p className="text-red-400/70 text-sm">{tradingState.pauseReason}</p>
          </div>
        </div>
      )}

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Trading Status"
          value={canTrade ? 'Ready' : 'Blocked'}
          icon={canTrade ? '✓' : '✗'}
          color={canTrade ? 'text-green-400' : 'text-red-400'}
          bgColor={canTrade ? 'bg-green-500/5' : 'bg-red-500/5'}
        />
        <StatCard
          label="Open Positions"
          value={`${tradingState.openPositionsCount} / ${limits.maxOpenPositions}`}
          subtitle={`${limits.maxOpenPositions - tradingState.openPositionsCount} slots available`}
          icon="📊"
        />
        <StatCard
          label="Consecutive Losses"
          value={tradingState.consecutiveLosses}
          subtitle={tradingState.consecutiveLosses >= 3 ? 'Risk threshold reached' : 'Within limits'}
          icon="📉"
          color={tradingState.consecutiveLosses >= 3 ? 'text-red-400' : 'text-white'}
        />
        <StatCard
          label="Capital Deployed"
          value={`$${tradingState.capitalDeployed.toLocaleString()}`}
          subtitle={`Max: ${limits.maxCapitalDeployedPercent}% of portfolio`}
          icon="💵"
        />
      </div>

      {/* P&L Section */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>📈</span> Profit & Loss
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PnLCard period="Daily" value={tradingState.dailyPnL} limitPercent={limits.dailyLossLimitPercent} />
          <PnLCard period="Weekly" value={tradingState.weeklyPnL} limitPercent={limits.weeklyLossLimitPercent} />
          <PnLCard period="Monthly" value={tradingState.monthlyPnL} limitPercent={limits.monthlyLossLimitPercent} />
        </div>
      </div>

      {/* Capital & Risk Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Capital Utilization */}
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-white font-medium mb-4">Capital Utilization</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Deployed Capital</span>
                <span className="text-white">${tradingState.capitalDeployed.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(capitalPercent, 100)}%` }}
                />
              </div>
              <p className="text-gray-500 text-xs mt-2">
                {capitalPercent.toFixed(1)}% of ${totalCapital.toLocaleString()} portfolio utilized
              </p>
            </div>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-white font-medium mb-4">Risk Limits</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <span className="text-gray-400 text-sm">Daily Loss Limit</span>
              <span className="text-white text-sm font-medium">-{limits.dailyLossLimitPercent}%</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <span className="text-gray-400 text-sm">Weekly Loss Limit</span>
              <span className="text-white text-sm font-medium">-{limits.weeklyLossLimitPercent}%</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <span className="text-gray-400 text-sm">Monthly Loss Limit</span>
              <span className="text-white text-sm font-medium">-{limits.monthlyLossLimitPercent}%</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400 text-sm">Max Capital Deployed</span>
              <span className="text-white text-sm font-medium">{limits.maxCapitalDeployedPercent}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Health */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          System Health
        </h2>
        <SystemHealth />
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-medium flex items-center gap-2">
            <span>📋</span> Recent Activity
          </h3>
          <Link
            href="/dashboard/activity"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            View All →
          </Link>
        </div>
        {recentActivity === null ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : recentActivity.length === 0 ? (
          <div className="text-gray-500 text-sm">No recent activity</div>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((item) => {
              const icon =
                item.type === 'position_opened' ? '📈' :
                item.type === 'trailing_stop_updated' ? '🔼' :
                item.type === 'position_closed' && item.details.pnl !== undefined && item.details.pnl > 0 ? '✅' :
                item.type === 'position_closed' ? '❌' : '📋';
              const timeAgo = getRelativeTime(item.timestamp);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2 border-b border-gray-700/50 last:border-0 cursor-pointer hover:bg-gray-700/30 rounded px-2 -mx-2"
                  onClick={() => item.positionId && window.location.assign(`/dashboard/positions?highlight=${item.positionId}`)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{icon}</span>
                    <span className="text-white font-medium">{item.symbol}</span>
                    <span className="text-gray-400 text-sm">{item.message}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{timeAgo}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
