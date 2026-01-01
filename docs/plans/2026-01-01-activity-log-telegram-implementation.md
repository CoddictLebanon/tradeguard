# Activity Log & Telegram Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a centralized activity log system with dashboard widget, dedicated page, and Telegram notifications for trade events.

**Architecture:** Extend existing ActivityLog entity with a new feed endpoint. Add a new TelegramModule for notifications. Create React components for the dashboard widget and activity page.

**Tech Stack:** NestJS (API), Next.js (Web), TypeORM (Database), Telegram Bot API

---

## Task 1: Activity Feed API Endpoint

**Files:**
- Modify: `apps/api/src/activity/activity.controller.ts`
- Modify: `apps/api/src/activity/activity.module.ts`
- Create: `apps/api/src/activity/activity.service.ts`
- Create: `apps/api/src/activity/dto/activity-feed.dto.ts`

### Step 1: Create the DTO for query parameters

Create `apps/api/src/activity/dto/activity-feed.dto.ts`:

```typescript
import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ActivityType } from '../../entities/activity-log.entity';

export class ActivityFeedQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsEnum(['win', 'loss'])
  outcome?: 'win' | 'loss';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  type: ActivityType;
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

export interface ActivityFeedResponse {
  items: ActivityFeedItem[];
  total: number;
  hasMore: boolean;
}
```

### Step 2: Create the Activity Service

Create `apps/api/src/activity/activity.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Like } from 'typeorm';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { ActivityFeedQueryDto, ActivityFeedResponse, ActivityFeedItem } from './dto/activity-feed.dto';

@Injectable()
export class ActivityService {
  // Trade event types only
  private readonly TRADE_EVENT_TYPES = [
    ActivityType.POSITION_OPENED,
    ActivityType.POSITION_CLOSED,
    ActivityType.TRAILING_STOP_UPDATED,
  ];

  constructor(
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
  ) {}

  async getFeed(query: ActivityFeedQueryDto): Promise<ActivityFeedResponse> {
    const { startDate, endDate, type, symbol, outcome, limit = 50, offset = 0 } = query;

    const whereClause: any = {
      type: type ? type : In(this.TRADE_EVENT_TYPES),
    };

    if (startDate && endDate) {
      whereClause.createdAt = Between(new Date(startDate), new Date(endDate + 'T23:59:59.999Z'));
    } else if (startDate) {
      whereClause.createdAt = Between(new Date(startDate), new Date());
    } else if (endDate) {
      whereClause.createdAt = Between(new Date('2020-01-01'), new Date(endDate + 'T23:59:59.999Z'));
    }

    if (symbol) {
      whereClause.symbol = symbol.toUpperCase();
    }

    const [items, total] = await this.activityRepo.findAndCount({
      where: whereClause,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // Filter by outcome if specified (for closed positions only)
    let filteredItems = items;
    if (outcome) {
      filteredItems = items.filter((item) => {
        if (item.type !== ActivityType.POSITION_CLOSED) return false;
        const pnl = item.details?.pnl as number | undefined;
        if (outcome === 'win') return pnl !== undefined && pnl > 0;
        if (outcome === 'loss') return pnl !== undefined && pnl <= 0;
        return true;
      });
    }

    const feedItems: ActivityFeedItem[] = filteredItems.map((item) => ({
      id: item.id,
      timestamp: item.createdAt.toISOString(),
      type: item.type,
      symbol: item.symbol,
      message: item.message,
      details: {
        entryPrice: item.details?.entryPrice as number | undefined,
        exitPrice: item.details?.exitPrice as number | undefined,
        stopPrice: item.details?.stopPrice as number | undefined,
        oldStopPrice: item.details?.oldStopPrice as number | undefined,
        newStopPrice: item.details?.newStopPrice as number | undefined,
        pnl: item.details?.pnl as number | undefined,
        outcome: item.details?.pnl !== undefined ? ((item.details.pnl as number) > 0 ? 'win' : 'loss') : undefined,
        shares: item.details?.shares as number | undefined,
      },
      positionId: item.positionId,
    }));

    return {
      items: feedItems,
      total,
      hasMore: offset + limit < total,
    };
  }
}
```

### Step 3: Update Activity Controller

Modify `apps/api/src/activity/activity.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityService } from './activity.service';
import { ActivityFeedQueryDto, ActivityFeedResponse } from './dto/activity-feed.dto';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('feed')
  async getFeed(@Query() query: ActivityFeedQueryDto): Promise<ActivityFeedResponse> {
    return this.activityService.getFeed(query);
  }
}
```

### Step 4: Update Activity Module

Modify `apps/api/src/activity/activity.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog])],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
```

### Step 5: Test the endpoint manually

Run: `curl -X GET "http://localhost:6667/activity/feed?limit=10" -H "Authorization: Bearer <token>"`

Expected: JSON response with `items`, `total`, `hasMore` fields

### Step 6: Commit

```bash
git add apps/api/src/activity/
git commit -m "feat(api): add activity feed endpoint with filtering"
```

---

## Task 2: Frontend API Client Update

**Files:**
- Modify: `apps/web/src/lib/api.ts`

### Step 1: Add activity feed API methods

Add to `apps/web/src/lib/api.ts` after the existing `getActivityLog` method:

```typescript
  // Activity Feed (centralized)
  getActivityFeed: (
    token: string,
    params?: {
      startDate?: string;
      endDate?: string;
      type?: string;
      symbol?: string;
      outcome?: 'win' | 'loss';
      limit?: number;
      offset?: number;
    }
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.symbol) searchParams.set('symbol', params.symbol);
    if (params?.outcome) searchParams.set('outcome', params.outcome);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return apiRequest<{
      items: Array<{
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
      }>;
      total: number;
      hasMore: boolean;
    }>(`/activity/feed${query ? `?${query}` : ''}`, { token });
  },
```

### Step 2: Commit

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add activity feed API client method"
```

---

## Task 3: Dashboard Activity Widget

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`

### Step 1: Add the Recent Activity widget

Add after the "Capital & Risk Section" div in `apps/web/src/app/dashboard/page.tsx`. First, add the import and state:

Add to imports at top:
```typescript
import Link from 'next/link';
```

Add new state variable after existing useState declarations:
```typescript
const [recentActivity, setRecentActivity] = useState<Array<{
  id: string;
  timestamp: string;
  type: string;
  symbol: string | null;
  message: string;
  details: { pnl?: number };
  positionId: string | null;
}> | null>(null);
```

Add to the useEffect fetchData function, after the existing API call:
```typescript
// Fetch recent activity
api.getActivityFeed(token, { limit: 10 }).then((res) => setRecentActivity(res.items)).catch(() => {});
```

Add the widget component before the final closing `</div>`:

```typescript
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
```

Add the helper function before the component's return statement:

```typescript
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
```

### Step 2: Commit

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): add recent activity widget to dashboard"
```

---

## Task 4: Activity Page

**Files:**
- Create: `apps/web/src/app/dashboard/activity/page.tsx`

### Step 1: Create the activity page

Create `apps/web/src/app/dashboard/activity/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type EventType = 'all' | 'position_opened' | 'trailing_stop_updated' | 'position_closed';
type DateRange = 'today' | '7days' | '30days' | 'custom';
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

export default function ActivityPage() {
  const token = useAuthStore((state) => state.token);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [eventType, setEventType] = useState<EventType>('all');
  const [symbol, setSymbol] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('all');
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetchActivity = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      let startDate: string | undefined;
      let endDate: string | undefined;

      if (dateRange === 'today') {
        startDate = now.toISOString().split('T')[0];
        endDate = startDate;
      } else if (dateRange === '7days') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (dateRange === '30days') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDate = monthAgo.toISOString().split('T')[0];
      } else if (dateRange === 'custom') {
        startDate = customStart || undefined;
        endDate = customEnd || undefined;
      }

      const result = await api.getActivityFeed(token, {
        startDate,
        endDate,
        type: eventType === 'all' ? undefined : eventType,
        symbol: symbol.trim() || undefined,
        outcome: outcome === 'all' ? undefined : outcome,
        limit,
        offset: page * limit,
      });

      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, [token, dateRange, customStart, customEnd, eventType, symbol, outcome, page]);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'position_opened': return 'Opened';
      case 'trailing_stop_updated': return 'Stop Raised';
      case 'position_closed': return 'Closed';
      default: return type;
    }
  };

  const getEventDetails = (item: ActivityItem) => {
    if (item.type === 'position_opened') {
      return `Entry $${item.details.entryPrice?.toFixed(2)}, Stop $${item.details.stopPrice?.toFixed(2)}`;
    }
    if (item.type === 'trailing_stop_updated') {
      return `$${item.details.oldStopPrice?.toFixed(2)} → $${item.details.newStopPrice?.toFixed(2)}`;
    }
    if (item.type === 'position_closed') {
      return `Exit $${item.details.exitPrice?.toFixed(2)}`;
    }
    return '';
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Log</h1>
        <p className="text-gray-400 text-sm mt-1">All trade events in one place</p>
      </div>

      {/* Filters */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex flex-wrap gap-4">
          {/* Date Range */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => { setDateRange(e.target.value as DateRange); setPage(0); }}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm"
            >
              <option value="today">Today</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Custom Date Inputs */}
          {dateRange === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => { setCustomStart(e.target.value); setPage(0); }}
                  className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => { setCustomEnd(e.target.value); setPage(0); }}
                  className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm"
                />
              </div>
            </>
          )}

          {/* Event Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <select
              value={eventType}
              onChange={(e) => { setEventType(e.target.value as EventType); setPage(0); }}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm"
            >
              <option value="all">All</option>
              <option value="position_opened">Opened</option>
              <option value="trailing_stop_updated">Stop Raised</option>
              <option value="position_closed">Closed</option>
            </select>
          </div>

          {/* Symbol */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setPage(0); }}
              placeholder="e.g. AAPL"
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm w-24"
            />
          </div>

          {/* Outcome (only for closed) */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => { setOutcome(e.target.value as Outcome); setPage(0); }}
              disabled={eventType !== 'all' && eventType !== 'position_closed'}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 text-sm disabled:opacity-50"
            >
              <option value="all">All</option>
              <option value="win">Wins</option>
              <option value="loss">Losses</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-center py-8">Loading...</div>
      ) : items.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700/50">
          <p className="text-gray-400">No activity matching your filters</p>
          <button
            onClick={() => {
              setDateRange('7days');
              setEventType('all');
              setSymbol('');
              setOutcome('all');
              setPage(0);
            }}
            className="mt-3 text-blue-400 hover:text-blue-300 text-sm"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700/50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Time</th>
                <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Symbol</th>
                <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Event</th>
                <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Details</th>
                <th className="text-right text-xs text-gray-400 font-medium px-4 py-3">P&L</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                  onClick={() => item.positionId && window.location.assign(`/dashboard/positions?highlight=${item.positionId}`)}
                >
                  <td className="px-4 py-3 text-sm text-gray-300">{formatDate(item.timestamp)}</td>
                  <td className="px-4 py-3 text-sm text-white font-medium">{item.symbol}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      item.type === 'position_opened' ? 'bg-blue-500/20 text-blue-400' :
                      item.type === 'trailing_stop_updated' ? 'bg-yellow-500/20 text-yellow-400' :
                      item.details.pnl !== undefined && item.details.pnl > 0 ? 'bg-green-500/20 text-green-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {getEventLabel(item.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{getEventDetails(item)}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {item.details.pnl !== undefined && (
                      <span className={item.details.pnl > 0 ? 'text-green-400' : 'text-red-400'}>
                        {item.details.pnl > 0 ? '+' : ''}${item.details.pnl.toFixed(2)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50">
              <span className="text-gray-400 text-sm">
                Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50 text-sm"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50 text-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Add navigation link

Modify `apps/web/src/app/dashboard/layout.tsx`, add to `navItems` array after the Watchlist entry:

```typescript
  { href: '/dashboard/activity', label: 'Activity', icon: '📋' },
```

### Step 3: Commit

```bash
git add apps/web/src/app/dashboard/activity/page.tsx apps/web/src/app/dashboard/layout.tsx
git commit -m "feat(web): add dedicated activity log page with filtering"
```

---

## Task 5: Telegram Module - Backend

**Files:**
- Create: `apps/api/src/telegram/telegram.module.ts`
- Create: `apps/api/src/telegram/telegram.service.ts`
- Create: `apps/api/src/telegram/telegram-notifier.service.ts`
- Modify: `apps/api/src/app.module.ts`

### Step 1: Create Telegram Service

Create `apps/api/src/telegram/telegram.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/settings.entity';

interface TelegramConfig {
  enabled: boolean;
  botToken: string | null;
  chatId: string | null;
  notifyOpened: boolean;
  notifyStopRaised: boolean;
  notifyClosed: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  async getConfig(): Promise<TelegramConfig> {
    const settings = await this.settingRepo.find({
      where: [
        { key: 'telegram_enabled' },
        { key: 'telegram_bot_token' },
        { key: 'telegram_chat_id' },
        { key: 'telegram_notify_opened' },
        { key: 'telegram_notify_stop_raised' },
        { key: 'telegram_notify_closed' },
      ],
    });

    const get = (key: string, defaultValue: any) => {
      const setting = settings.find((s) => s.key === key);
      return setting ? setting.value : defaultValue;
    };

    return {
      enabled: get('telegram_enabled', false),
      botToken: get('telegram_bot_token', null),
      chatId: get('telegram_chat_id', null),
      notifyOpened: get('telegram_notify_opened', true),
      notifyStopRaised: get('telegram_notify_stop_raised', true),
      notifyClosed: get('telegram_notify_closed', true),
    };
  }

  async updateConfig(config: Partial<TelegramConfig>): Promise<void> {
    const now = new Date();
    const updates: Array<{ key: string; value: any }> = [];

    if (config.enabled !== undefined) updates.push({ key: 'telegram_enabled', value: config.enabled });
    if (config.botToken !== undefined) updates.push({ key: 'telegram_bot_token', value: config.botToken });
    if (config.chatId !== undefined) updates.push({ key: 'telegram_chat_id', value: config.chatId });
    if (config.notifyOpened !== undefined) updates.push({ key: 'telegram_notify_opened', value: config.notifyOpened });
    if (config.notifyStopRaised !== undefined) updates.push({ key: 'telegram_notify_stop_raised', value: config.notifyStopRaised });
    if (config.notifyClosed !== undefined) updates.push({ key: 'telegram_notify_closed', value: config.notifyClosed });

    for (const { key, value } of updates) {
      await this.settingRepo.upsert({ key, value, updatedAt: now }, ['key']);
    }
  }

  async sendMessage(text: string): Promise<boolean> {
    const config = await this.getConfig();

    if (!config.enabled || !config.botToken || !config.chatId) {
      this.logger.debug('Telegram not configured, skipping message');
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Telegram API error: ${error}`);
        return false;
      }

      this.logger.log(`Telegram message sent: ${text}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send Telegram message: ${err}`);
      return false;
    }
  }

  async sendTestMessage(): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig();

    if (!config.botToken || !config.chatId) {
      return { success: false, error: 'Bot token and chat ID are required' };
    }

    try {
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: '✅ TradeGuard connected successfully!',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.description || 'Failed to send message' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
```

### Step 2: Create Telegram Notifier Service

Create `apps/api/src/telegram/telegram-notifier.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramService } from './telegram.service';
import { ActivityType } from '../entities/activity-log.entity';

interface TradeEvent {
  type: ActivityType;
  symbol: string;
  details: Record<string, any>;
}

@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(private readonly telegramService: TelegramService) {}

  @OnEvent('activity.trade')
  async handleTradeEvent(event: TradeEvent): Promise<void> {
    const config = await this.telegramService.getConfig();

    if (!config.enabled) return;

    // Check if this event type should trigger a notification
    if (event.type === ActivityType.POSITION_OPENED && !config.notifyOpened) return;
    if (event.type === ActivityType.TRAILING_STOP_UPDATED && !config.notifyStopRaised) return;
    if (event.type === ActivityType.POSITION_CLOSED && !config.notifyClosed) return;

    const message = this.formatMessage(event);
    if (message) {
      await this.telegramService.sendMessage(message);
    }
  }

  private formatMessage(event: TradeEvent): string | null {
    const { type, symbol, details } = event;

    switch (type) {
      case ActivityType.POSITION_OPENED:
        return `📈 ${symbol} opened at $${details.entryPrice?.toFixed(2)}`;

      case ActivityType.TRAILING_STOP_UPDATED:
        return `🔼 ${symbol} stop raised to $${details.newStopPrice?.toFixed(2)}`;

      case ActivityType.POSITION_CLOSED:
        const pnl = details.pnl as number;
        const icon = pnl > 0 ? '✅' : '❌';
        const sign = pnl > 0 ? '+' : '';
        return `${icon} ${symbol} closed ${sign}$${pnl?.toFixed(2)}`;

      default:
        return null;
    }
  }
}
```

### Step 3: Create Telegram Controller

Create `apps/api/src/telegram/telegram.controller.ts`:

```typescript
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';

@Controller('telegram')
@UseGuards(JwtAuthGuard)
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Get('config')
  async getConfig() {
    const config = await this.telegramService.getConfig();
    // Don't expose the bot token in full
    return {
      enabled: config.enabled,
      botToken: config.botToken ? '***configured***' : null,
      chatId: config.chatId,
      notifyOpened: config.notifyOpened,
      notifyStopRaised: config.notifyStopRaised,
      notifyClosed: config.notifyClosed,
    };
  }

  @Post('config')
  async updateConfig(
    @Body() body: {
      enabled?: boolean;
      botToken?: string;
      chatId?: string;
      notifyOpened?: boolean;
      notifyStopRaised?: boolean;
      notifyClosed?: boolean;
    },
  ) {
    await this.telegramService.updateConfig(body);
    return { success: true };
  }

  @Post('test')
  async sendTestMessage() {
    return this.telegramService.sendTestMessage();
  }
}
```

### Step 4: Create Telegram Module

Create `apps/api/src/telegram/telegram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { Setting } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramNotifierService],
  exports: [TelegramService],
})
export class TelegramModule {}
```

### Step 5: Register Telegram Module

Modify `apps/api/src/app.module.ts`, add import:

```typescript
import { TelegramModule } from './telegram/telegram.module';
```

Add to imports array:

```typescript
TelegramModule,
```

### Step 6: Commit

```bash
git add apps/api/src/telegram/ apps/api/src/app.module.ts
git commit -m "feat(api): add Telegram notification module"
```

---

## Task 6: Emit Trade Events for Telegram

**Files:**
- Modify: `apps/api/src/positions/positions.service.ts` (or wherever activity logs are created)

### Step 1: Find where activity logs are created

Search for `ActivityType.POSITION_OPENED` in the codebase to find where to emit events.

### Step 2: Add event emission

Wherever `ActivityLog` entries are created for trade events, add:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

// In constructor:
constructor(
  private readonly eventEmitter: EventEmitter2,
  // ... other deps
) {}

// After saving activity log:
this.eventEmitter.emit('activity.trade', {
  type: ActivityType.POSITION_OPENED, // or appropriate type
  symbol: position.symbol,
  details: { entryPrice, stopPrice, ... },
});
```

### Step 3: Commit

```bash
git add apps/api/src/positions/
git commit -m "feat(api): emit trade events for Telegram notifications"
```

---

## Task 7: Frontend Telegram Settings

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`

### Step 1: Add Telegram API methods

Add to `apps/web/src/lib/api.ts`:

```typescript
  // Telegram
  getTelegramConfig: (token: string) =>
    apiRequest<{
      enabled: boolean;
      botToken: string | null;
      chatId: string | null;
      notifyOpened: boolean;
      notifyStopRaised: boolean;
      notifyClosed: boolean;
    }>('/telegram/config', { token }),

  updateTelegramConfig: (
    token: string,
    config: {
      enabled?: boolean;
      botToken?: string;
      chatId?: string;
      notifyOpened?: boolean;
      notifyStopRaised?: boolean;
      notifyClosed?: boolean;
    },
  ) =>
    apiRequest<{ success: boolean }>('/telegram/config', {
      method: 'POST',
      token,
      body: config,
    }),

  sendTelegramTest: (token: string) =>
    apiRequest<{ success: boolean; error?: string }>('/telegram/test', {
      method: 'POST',
      token,
    }),
```

### Step 2: Add Notifications tab to Settings

Modify `apps/web/src/app/dashboard/settings/page.tsx`:

Add 'notifications' to the SettingsTab type:
```typescript
type SettingsTab = 'account' | 'trading' | 'risk' | 'simulation' | 'notifications';
```

Add to tabs array:
```typescript
{ id: 'notifications', label: 'Notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
```

Add state for Telegram config after existing useState declarations:
```typescript
const [telegramConfig, setTelegramConfig] = useState<{
  enabled: boolean;
  botToken: string | null;
  chatId: string | null;
  notifyOpened: boolean;
  notifyStopRaised: boolean;
  notifyClosed: boolean;
} | null>(null);
const [telegramBotToken, setTelegramBotToken] = useState('');
const [telegramChatId, setTelegramChatId] = useState('');
const [telegramTesting, setTelegramTesting] = useState(false);
const [showBotToken, setShowBotToken] = useState(false);
```

Add to fetchSettings function:
```typescript
api.getTelegramConfig(token).then((config) => {
  setTelegramConfig(config);
  setTelegramChatId(config.chatId || '');
}).catch(() => {});
```

Add Notifications tab content after Simulation tab:
```typescript
        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Notification Settings</h2>
              <p className="text-gray-400 text-sm">Configure Telegram notifications for trade events.</p>
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-medium text-white">Telegram Integration</h3>
                  <p className="text-gray-400 text-sm mt-1">Receive notifications via Telegram bot</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={telegramConfig?.enabled ?? false}
                    onChange={(e) => setTelegramConfig(prev => prev ? { ...prev, enabled: e.target.checked } : null)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Bot Token</label>
                  <div className="flex gap-2">
                    <input
                      type={showBotToken ? 'text' : 'password'}
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder={telegramConfig?.botToken || 'Enter bot token from @BotFather'}
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBotToken(!showBotToken)}
                      className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-400 hover:text-white"
                    >
                      {showBotToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Create a bot via @BotFather on Telegram</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Chat ID</label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="Enter your chat ID"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Message @userinfobot to get your chat ID</p>
                </div>

                <button
                  onClick={async () => {
                    if (!token) return;
                    setTelegramTesting(true);
                    setError(null);
                    try {
                      // Save config first if token/chatId changed
                      if (telegramBotToken || telegramChatId) {
                        await api.updateTelegramConfig(token, {
                          botToken: telegramBotToken || undefined,
                          chatId: telegramChatId || undefined,
                        });
                      }
                      const result = await api.sendTelegramTest(token);
                      if (result.success) {
                        setSuccess('Test message sent successfully!');
                      } else {
                        setError(result.error || 'Failed to send test message');
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to send test message');
                    } finally {
                      setTelegramTesting(false);
                    }
                  }}
                  disabled={telegramTesting || (!telegramConfig?.botToken && !telegramBotToken)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg text-sm"
                >
                  {telegramTesting ? 'Sending...' : 'Send Test Message'}
                </button>
              </div>

              <hr className="border-gray-700 my-6" />

              <div>
                <h4 className="text-white font-medium mb-4">Notify me when:</h4>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={telegramConfig?.notifyOpened ?? true}
                      onChange={(e) => setTelegramConfig(prev => prev ? { ...prev, notifyOpened: e.target.checked } : null)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-gray-300">Position opened</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={telegramConfig?.notifyStopRaised ?? true}
                      onChange={(e) => setTelegramConfig(prev => prev ? { ...prev, notifyStopRaised: e.target.checked } : null)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-gray-300">Stop raised</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={telegramConfig?.notifyClosed ?? true}
                      onChange={(e) => setTelegramConfig(prev => prev ? { ...prev, notifyClosed: e.target.checked } : null)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-gray-300">Position closed</span>
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={async () => {
                    if (!token || !telegramConfig) return;
                    setSaving(true);
                    try {
                      await api.updateTelegramConfig(token, {
                        enabled: telegramConfig.enabled,
                        botToken: telegramBotToken || undefined,
                        chatId: telegramChatId || undefined,
                        notifyOpened: telegramConfig.notifyOpened,
                        notifyStopRaised: telegramConfig.notifyStopRaised,
                        notifyClosed: telegramConfig.notifyClosed,
                      });
                      setSuccess('Notification settings saved');
                      setTelegramBotToken('');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to save settings');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
                >
                  {saving ? 'Saving...' : 'Save Notification Settings'}
                </button>
              </div>
            </div>
          </div>
        )}
```

### Step 3: Commit

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat(web): add Telegram notification settings UI"
```

---

## Task 8: Final Integration & Testing

### Step 1: Start the API and Web servers

```bash
cd apps/api && npm run dev &
cd apps/web && npm run dev &
```

### Step 2: Test the activity feed endpoint

```bash
curl "http://localhost:6667/activity/feed?limit=5" -H "Authorization: Bearer <token>"
```

### Step 3: Verify dashboard widget appears

Navigate to `http://localhost:3000/dashboard` and confirm the Recent Activity widget is visible.

### Step 4: Verify activity page works

Navigate to `http://localhost:3000/dashboard/activity` and test filters.

### Step 5: Configure Telegram and send test message

Go to Settings → Notifications and configure Telegram bot.

### Step 6: Final commit

```bash
git add -A
git commit -m "feat: complete activity log and Telegram notification integration"
```

---

## Summary

**Total Tasks:** 8
**Estimated Implementation Time:** ~2-3 hours

**What's been built:**
1. Activity feed API with filtering by date, type, symbol, outcome
2. Dashboard widget showing last 10 trade events
3. Dedicated activity page with full filtering and pagination
4. Telegram notification module with configurable event types
5. Settings UI for Telegram configuration with test message
