'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Activity {
  id: string;
  type: string;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Position {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  stopPrice?: number;
  status: string;
  openedAt: string;
}

interface Props {
  position: Position | null;
  onClose: () => void;
}

const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
  position_opened: { label: 'OPENED', color: 'text-green-400', icon: '●' },
  trailing_stop_updated: { label: 'STOP RAISED', color: 'text-blue-400', icon: '▲' },
  position_closed: { label: 'CLOSED', color: 'text-red-400', icon: '■' },
  order_filled: { label: 'FILLED', color: 'text-yellow-400', icon: '◆' },
};

function PriceChart({ dailyData, entryPrice, stopPrice }: { dailyData: DailyBar[]; entryPrice: number; stopPrice: number }) {
  if (!dailyData || dailyData.length === 0) {
    return <div className="h-48 flex items-center justify-center text-gray-500">No chart data available</div>;
  }

  const minPrice = Math.min(...dailyData.map(d => d.low), stopPrice, entryPrice);
  const maxPrice = Math.max(...dailyData.map(d => d.high), entryPrice);
  const padding = (maxPrice - minPrice) * 0.05;
  const chartMin = minPrice - padding;
  const chartMax = maxPrice + padding;
  const range = chartMax - chartMin || 1;

  const entryY = 100 - ((entryPrice - chartMin) / range) * 100;
  const stopY = 100 - ((stopPrice - chartMin) / range) * 100;

  return (
    <div>
      <svg className="w-full h-48" viewBox={`0 0 ${dailyData.length * 10} 100`} preserveAspectRatio="none">
        {/* Entry price line */}
        <line
          x1="0"
          y1={entryY}
          x2={dailyData.length * 10}
          y2={entryY}
          stroke="#3b82f6"
          strokeWidth="1"
          strokeDasharray="4,2"
        />
        {/* Stop price line */}
        <line
          x1="0"
          y1={stopY}
          x2={dailyData.length * 10}
          y2={stopY}
          stroke="#f87171"
          strokeWidth="1.5"
          strokeDasharray="4,2"
        />
        {/* Price bars */}
        {dailyData.map((day, idx) => {
          const x = idx * 10 + 2;
          const highY = 100 - ((day.high - chartMin) / range) * 100;
          const lowY = 100 - ((day.low - chartMin) / range) * 100;
          const openY = 100 - ((day.open - chartMin) / range) * 100;
          const closeY = 100 - ((day.close - chartMin) / range) * 100;
          const isUp = day.close >= day.open;
          const color = isUp ? '#22c55e' : '#ef4444';

          return (
            <g key={idx}>
              {/* High-low wick */}
              <line x1={x + 3} y1={highY} x2={x + 3} y2={lowY} stroke={color} strokeWidth="1" />
              {/* Open-close body */}
              <rect
                x={x}
                y={Math.min(openY, closeY)}
                width="6"
                height={Math.max(Math.abs(closeY - openY), 1)}
                fill={color}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>{dailyData[0]?.date}</span>
        <span className="flex items-center gap-3">
          <span className="text-blue-400">— Entry</span>
          <span className="text-red-400">— Stop</span>
        </span>
        <span>{dailyData[dailyData.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function PositionActivityDrawer({ position, onClose }: Props) {
  const token = useAuthStore((state) => state.token);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dailyData, setDailyData] = useState<DailyBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (!position || !token) return;

    setLoading(true);
    api
      .getPositionActivity(token, position.id)
      .then(setActivities)
      .catch(console.error)
      .finally(() => setLoading(false));

    // Fetch price chart data
    setChartLoading(true);
    api
      .getPositionChart(token, position.id)
      .then(setDailyData)
      .catch(console.error)
      .finally(() => setChartLoading(false));
  }, [position, token]);

  if (!position) return null;

  const entryPrice = Number(position.entryPrice);
  const currentPrice = Number(position.currentPrice);
  const stopPrice = Number(position.stopPrice) || 0;
  const pnl = (currentPrice - entryPrice) * position.shares;
  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  // Use portal to render at document body level for proper z-index stacking
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop - covers entire viewport */}
      <div
        className="fixed inset-0 bg-black/70"
        style={{ zIndex: 9998 }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-screen w-[420px] bg-gray-900 border-l border-gray-700 overflow-y-auto"
        style={{ zIndex: 9999 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">{position.symbol}</h2>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  position.status === 'open'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {position.status.toUpperCase()}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Price Chart */}
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Price Chart</h3>
          {chartLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-500">Loading chart...</div>
          ) : (
            <PriceChart dailyData={dailyData} entryPrice={entryPrice} stopPrice={stopPrice} />
          )}
        </div>

        {/* Summary */}
        <div className="p-4 border-b border-gray-800">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Entry</div>
              <div className="text-white font-medium">${entryPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500">Current</div>
              <div className="text-white font-medium">${currentPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500">Stop</div>
              <div className="text-red-400 font-medium">${stopPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500">P/L</div>
              <div className={`font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPercent.toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Activity Timeline</h3>

          {loading ? (
            <div className="text-gray-500 text-center py-8">Loading...</div>
          ) : activities.length === 0 ? (
            <div className="text-gray-500 text-center py-8">No activity recorded yet</div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => {
                const config = typeConfig[activity.type] || {
                  label: activity.type.toUpperCase(),
                  color: 'text-gray-400',
                  icon: '○',
                };
                const date = new Date(activity.createdAt);
                const dateStr = date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
                const timeStr = date.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div key={activity.id} className="flex gap-3">
                    <div className={`${config.color} text-lg leading-none pt-0.5`}>
                      {config.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {dateStr} {timeStr}
                        </span>
                      </div>
                      <div className="text-sm text-gray-300 mt-0.5">
                        {activity.message}
                      </div>
                      {activity.details && activity.type === 'trailing_stop_updated' && (
                        <div className="text-xs text-gray-500 mt-1">
                          {(activity.details as { reason?: string }).reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
