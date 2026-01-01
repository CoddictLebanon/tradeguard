'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type DateRange = 'today' | 'last7' | 'last30' | 'custom';
type EventType = 'all' | 'position_opened' | 'trailing_stop_updated' | 'position_closed';
type Outcome = 'all' | 'win' | 'loss';

interface ActivityItem {
  id: string;
  timestamp: string;
  type: string;
  symbol: string | null;
  message: string;
  details: {
    entryPrice?: number;
    exitPrice?: number;
    stopPrice?: number;
    oldStopPrice?: number;
    newStopPrice?: number;
    pnl?: number;
    outcome?: 'win' | 'loss';
    shares?: number;
  };
  positionId: string | null;
}

const PAGE_SIZE = 20;

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getDateRange(range: DateRange, customStart?: string, customEnd?: string): { startDate?: string; endDate?: string } {
  const now = new Date();
  const endDate = now.toISOString();

  switch (range) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start.toISOString(), endDate };
    }
    case 'last7': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { startDate: start.toISOString(), endDate };
    }
    case 'last30': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { startDate: start.toISOString(), endDate };
    }
    case 'custom': {
      return {
        startDate: customStart ? new Date(customStart).toISOString() : undefined,
        endDate: customEnd ? new Date(customEnd + 'T23:59:59').toISOString() : undefined,
      };
    }
  }
}

function EventBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; bg: string; text: string }> = {
    position_opened: { label: 'Opened', bg: 'bg-blue-500/20', text: 'text-blue-400' },
    trailing_stop_updated: { label: 'Stop Raised', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
    position_closed: { label: 'Closed', bg: 'bg-purple-500/20', text: 'text-purple-400' },
  };

  const { label, bg, text } = config[type] || { label: type, bg: 'bg-gray-500/20', text: 'text-gray-400' };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

function getEventDetails(item: ActivityItem): string {
  const { type, details } = item;

  switch (type) {
    case 'position_opened':
      return details.entryPrice
        ? `Entry @ $${details.entryPrice.toFixed(2)}${details.shares ? ` (${details.shares} shares)` : ''}`
        : '';
    case 'trailing_stop_updated':
      if (details.oldStopPrice && details.newStopPrice) {
        return `Stop: $${details.oldStopPrice.toFixed(2)} -> $${details.newStopPrice.toFixed(2)}`;
      }
      return details.stopPrice ? `Stop @ $${details.stopPrice.toFixed(2)}` : '';
    case 'position_closed':
      return details.exitPrice
        ? `Exit @ $${details.exitPrice.toFixed(2)}${details.shares ? ` (${details.shares} shares)` : ''}`
        : '';
    default:
      return '';
  }
}

export default function ActivityPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);

  // Filter state
  const [dateRange, setDateRange] = useState<DateRange>('last7');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [eventType, setEventType] = useState<EventType>('all');
  const [symbol, setSymbol] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('all');

  // Data state
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const { startDate, endDate } = getDateRange(dateRange, customStartDate, customEndDate);

      const params: Parameters<typeof api.getActivityFeed>[1] = {
        limit: PAGE_SIZE,
        offset,
      };

      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (eventType !== 'all') params.type = eventType;
      if (symbol.trim()) params.symbol = symbol.trim().toUpperCase();
      if (outcome !== 'all' && (eventType === 'all' || eventType === 'position_closed')) {
        params.outcome = outcome;
      }

      const result = await api.getActivityFeed(token, params);
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [token, dateRange, customStartDate, customEndDate, eventType, symbol, outcome, offset]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Reset offset when filters change (except offset itself)
  useEffect(() => {
    setOffset(0);
  }, [dateRange, customStartDate, customEndDate, eventType, symbol, outcome]);

  const handleResetFilters = () => {
    setDateRange('last7');
    setCustomStartDate('');
    setCustomEndDate('');
    setEventType('all');
    setSymbol('');
    setOutcome('all');
    setOffset(0);
  };

  const handleRowClick = (item: ActivityItem) => {
    if (item.positionId) {
      router.push(`/dashboard/positions?highlight=${item.positionId}`);
    }
  };

  const startItem = offset + 1;
  const endItem = Math.min(offset + PAGE_SIZE, total);
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;

  const isOutcomeDisabled = eventType !== 'all' && eventType !== 'position_closed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Log</h1>
        <p className="text-gray-400 text-sm mt-1">View and filter all trading activity</p>
      </div>

      {/* Filter Bar */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Date Range */}
          <div className="flex flex-col gap-1">
            <label className="text-gray-400 text-xs font-medium">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Custom Date Inputs */}
          {dateRange === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-gray-400 text-xs font-medium">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-gray-400 text-xs font-medium">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Event Type */}
          <div className="flex flex-col gap-1">
            <label className="text-gray-400 text-xs font-medium">Event Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="position_opened">Opened</option>
              <option value="trailing_stop_updated">Stop Raised</option>
              <option value="position_closed">Closed</option>
            </select>
          </div>

          {/* Symbol */}
          <div className="flex flex-col gap-1">
            <label className="text-gray-400 text-xs font-medium">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. AAPL"
              className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none w-28"
            />
          </div>

          {/* Outcome */}
          <div className="flex flex-col gap-1">
            <label className="text-gray-400 text-xs font-medium">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
              disabled={isOutcomeDisabled}
              className={`bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none ${
                isOutcomeDisabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <option value="all">All</option>
              <option value="win">Wins</option>
              <option value="loss">Losses</option>
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Reset Button */}
          <button
            onClick={handleResetFilters}
            className="text-gray-400 hover:text-white text-sm px-3 py-2"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Activity Table */}
      <div className="bg-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-gray-400">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              Loading activity...
            </div>
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">!</span>
                <div>
                  <p className="font-medium">Failed to load activity</p>
                  <p className="text-sm text-red-400/70 mt-1">{error}</p>
                </div>
              </div>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <span className="text-4xl mb-3">-</span>
            <p className="text-lg font-medium">No activity matching your filters</p>
            <p className="text-sm mt-1">Try adjusting your filter criteria</p>
            <button
              onClick={handleResetFilters}
              className="mt-4 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="text-left text-gray-400 text-xs font-medium px-4 py-3">Time</th>
                  <th className="text-left text-gray-400 text-xs font-medium px-4 py-3">Symbol</th>
                  <th className="text-left text-gray-400 text-xs font-medium px-4 py-3">Event</th>
                  <th className="text-left text-gray-400 text-xs font-medium px-4 py-3">Details</th>
                  <th className="text-right text-gray-400 text-xs font-medium px-4 py-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const pnl = item.details.pnl;
                  const hasPnl = typeof pnl === 'number';
                  const pnlPositive = hasPnl && pnl >= 0;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleRowClick(item)}
                      className={`border-t border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                        item.positionId ? 'cursor-pointer' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-400 text-sm">
                        {formatTime(item.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-white font-semibold">{item.symbol || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <EventBadge type={item.type} />
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-sm">
                        {getEventDetails(item) || item.message}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasPnl ? (
                          <span className={`font-medium ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                            {pnlPositive ? '+' : ''}${pnl.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50 bg-gray-700/30">
              <div className="text-gray-400 text-sm">
                Showing {startItem}-{endItem} of {total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={!hasPrev}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    hasPrev
                      ? 'bg-gray-700 text-white hover:bg-gray-600'
                      : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasNext}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    hasNext
                      ? 'bg-gray-700 text-white hover:bg-gray-600'
                      : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
