'use client';

import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface PerformanceData {
  currentValue: number;
  periodStart: number;
  periodChange: number;
  periodChangePercent: number;
  dataPoints: Array<{ date: string; value: number }>;
}

const PERIODS = [
  { key: '1d', label: '1D' },
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'ALL' },
];

export function PortfolioChart() {
  const token = useAuthStore((state) => state.token);
  const [period, setPeriod] = useState('1m');
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.getPortfolioPerformance(token, period);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch performance:', err);
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isPositive = data ? data.periodChange >= 0 : true;
  const changeColor = isPositive ? 'text-green-400' : 'text-red-400';
  const chartColor = isPositive ? '#22c55e' : '#ef4444';
  const chartGradient = isPositive ? 'url(#greenGradient)' : 'url(#redGradient)';

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatTooltipValue = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-gray-400 text-sm mb-1">Portfolio Value</p>
          <p className="text-4xl font-bold text-white">
            {loading ? '...' : formatCurrency(data?.currentValue || 0)}
          </p>
          {data && (
            <p className={`text-lg mt-1 ${changeColor}`}>
              {isPositive ? '+' : ''}{formatCurrency(data.periodChange)}
              <span className="text-sm ml-2">
                ({isPositive ? '+' : ''}{data.periodChangePercent.toFixed(2)}%)
              </span>
            </p>
          )}
        </div>

        {/* Period Selector */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === p.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            Loading chart...
          </div>
        ) : data?.dataPoints && data.dataPoints.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dataPoints} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="redGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickFormatter={(date) => {
                  const d = new Date(date);
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                domain={['dataMin - 1000', 'dataMax + 1000']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(value: number | undefined) => [formatTooltipValue(value ?? 0), 'Value']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={2}
                fill={chartGradient}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p>No historical data yet</p>
              <p className="text-sm mt-1">Portfolio snapshots will appear here over time</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
