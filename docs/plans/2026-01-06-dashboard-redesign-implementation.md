# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the dashboard with a hero portfolio performance graph, compact positions table, and modern fintech styling.

**Architecture:** Backend adds portfolio_snapshots table with daily cron job to track portfolio value over time. New API endpoint serves historical data. Frontend uses Recharts for the performance graph, with refactored components for positions table and stat cards.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Next.js, React, Recharts, TailwindCSS

---

## Task 1: Create Portfolio Snapshot Entity

**Files:**
- Create: `apps/api/src/entities/portfolio-snapshot.entity.ts`

**Step 1: Create the entity file**

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('portfolio_snapshots')
export class PortfolioSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalValue: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  cash: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  positionsValue: number;

  @Column({ type: 'int', default: 0 })
  positionCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/entities/portfolio-snapshot.entity.ts
git commit -m "feat(api): add PortfolioSnapshot entity"
```

---

## Task 2: Create Database Migration

**Files:**
- Create: `apps/api/src/migrations/1736200000000-AddPortfolioSnapshots.ts`

**Step 1: Create the migration file**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortfolioSnapshots1736200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE portfolio_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL UNIQUE,
        "totalValue" DECIMAL(15,2) NOT NULL,
        cash DECIMAL(15,2),
        "positionsValue" DECIMAL(15,2),
        "positionCount" INT DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_portfolio_snapshots_date ON portfolio_snapshots(date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS portfolio_snapshots');
  }
}
```

**Step 2: Run the migration**

Run: `cd apps/api && npx typeorm migration:run -d src/database/data-source.ts`

If data-source.ts doesn't exist, run directly via the app:
Run: `pm2 restart tradeguard-api && sleep 5 && pm2 logs tradeguard-api --lines 20 --nostream`
Expected: Table created (TypeORM synchronize will create it)

**Step 3: Verify table exists**

Run: `PGPASSWORD=boardmeeting123 psql -h localhost -U postgres -d tradeguard -c "\d portfolio_snapshots"`
Expected: Table schema displayed

**Step 4: Commit**

```bash
git add apps/api/src/migrations/
git commit -m "feat(api): add portfolio_snapshots migration"
```

---

## Task 3: Create Portfolio Module and Service

**Files:**
- Create: `apps/api/src/portfolio/portfolio.module.ts`
- Create: `apps/api/src/portfolio/portfolio.service.ts`
- Create: `apps/api/src/portfolio/portfolio.controller.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Create portfolio.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PortfolioSnapshot } from '../entities/portfolio-snapshot.entity';
import { IBService } from '../ib/ib.service';
import { ConfigService } from '@nestjs/config';

export interface PerformanceData {
  currentValue: number;
  periodStart: number;
  periodChange: number;
  periodChangePercent: number;
  dataPoints: Array<{ date: string; value: number }>;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectRepository(PortfolioSnapshot)
    private snapshotRepo: Repository<PortfolioSnapshot>,
    private readonly ibService: IBService,
    private readonly configService: ConfigService,
  ) {}

  // Run at 4:30 PM ET on weekdays (after market close)
  @Cron('30 16 * * 1-5', { timeZone: 'America/New_York' })
  async takeSnapshot(): Promise<PortfolioSnapshot | null> {
    this.logger.log('Taking daily portfolio snapshot...');

    try {
      const today = new Date().toISOString().split('T')[0];

      // Check if snapshot already exists for today
      const existing = await this.snapshotRepo.findOne({ where: { date: new Date(today) } });
      if (existing) {
        this.logger.log(`Snapshot already exists for ${today}`);
        return existing;
      }

      // Get account info from IB
      const account = await this.ibService.getAccountFromProxy();
      const positions = await this.ibService.getPositionsFromProxy();

      const totalValue = account?.NetLiquidation || 0;
      const cash = account?.TotalCashValue || 0;
      const positionsValue = positions.reduce((sum, p) => sum + (p.position * p.avgCost), 0);

      const snapshot = this.snapshotRepo.create({
        date: new Date(today),
        totalValue,
        cash,
        positionsValue,
        positionCount: positions.length,
      });

      await this.snapshotRepo.save(snapshot);
      this.logger.log(`Saved portfolio snapshot: $${totalValue.toLocaleString()}`);

      return snapshot;
    } catch (error) {
      this.logger.error(`Failed to take snapshot: ${(error as Error).message}`);
      return null;
    }
  }

  async getPerformance(period: string): Promise<PerformanceData> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case '1d':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '1m':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case '3m':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case '6m':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case 'mtd':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'ytd':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
      default:
        startDate = new Date('2020-01-01');
        break;
    }

    const snapshots = await this.snapshotRepo.find({
      where: { date: MoreThanOrEqual(startDate) },
      order: { date: 'ASC' },
    });

    // Get current value (latest snapshot or from IB)
    let currentValue = 0;
    if (snapshots.length > 0) {
      currentValue = Number(snapshots[snapshots.length - 1].totalValue);
    } else {
      try {
        const account = await this.ibService.getAccountFromProxy();
        currentValue = account?.NetLiquidation || 0;
      } catch {
        currentValue = this.configService.get<number>('TOTAL_CAPITAL', 100000);
      }
    }

    const periodStart = snapshots.length > 0 ? Number(snapshots[0].totalValue) : currentValue;
    const periodChange = currentValue - periodStart;
    const periodChangePercent = periodStart > 0 ? (periodChange / periodStart) * 100 : 0;

    return {
      currentValue,
      periodStart,
      periodChange,
      periodChangePercent,
      dataPoints: snapshots.map(s => ({
        date: s.date instanceof Date ? s.date.toISOString().split('T')[0] : String(s.date),
        value: Number(s.totalValue),
      })),
    };
  }

  async getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return this.snapshotRepo.findOne({
      order: { date: 'DESC' },
    });
  }
}
```

**Step 2: Create portfolio.controller.ts**

```typescript
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortfolioService, PerformanceData } from './portfolio.service';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('performance')
  async getPerformance(
    @Query('period') period: string = '1m',
  ): Promise<PerformanceData> {
    return this.portfolioService.getPerformance(period);
  }

  @Post('snapshot')
  async takeSnapshot() {
    const snapshot = await this.portfolioService.takeSnapshot();
    return { success: !!snapshot, snapshot };
  }
}
```

**Step 3: Create portfolio.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioSnapshot } from '../entities/portfolio-snapshot.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { IBModule } from '../ib/ib.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PortfolioSnapshot]),
    IBModule,
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
```

**Step 4: Register in app.module.ts**

Add to imports array in `apps/api/src/app.module.ts`:

```typescript
import { PortfolioModule } from './portfolio/portfolio.module';

// In @Module imports array, add:
PortfolioModule,
```

**Step 5: Build and verify**

Run: `cd apps/api && npm run build`
Expected: Build succeeds

**Step 6: Restart and test endpoint**

Run: `pm2 restart tradeguard-api && sleep 4`
Run: `curl -s http://localhost:3667/portfolio/performance?period=1m -H "Authorization: Bearer $(curl -s http://localhost:3667/auth/login -H "Content-Type: application/json" -d '{"email":"danymoussa@gmail.com","password":"!Mila101z"}' | jq -r '.accessToken')" | jq .`
Expected: JSON response with performance data (may have empty dataPoints initially)

**Step 7: Commit**

```bash
git add apps/api/src/portfolio/ apps/api/src/app.module.ts apps/api/src/entities/portfolio-snapshot.entity.ts
git commit -m "feat(api): add portfolio performance endpoint"
```

---

## Task 4: Add Recharts to Frontend

**Files:**
- Modify: `apps/web/package.json`

**Step 1: Install Recharts**

Run: `cd apps/web && npm install recharts`

**Step 2: Verify installation**

Run: `cat apps/web/package.json | grep recharts`
Expected: "recharts": "^2.x.x"

**Step 3: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore(web): add recharts for portfolio chart"
```

---

## Task 5: Add Portfolio API Client Methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Add getPortfolioPerformance method**

Add to the `api` object in `apps/web/src/lib/api.ts`:

```typescript
getPortfolioPerformance: async (token: string, period: string = '1m') => {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/portfolio/performance?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch portfolio performance');
  return res.json();
},

takePortfolioSnapshot: async (token: string) => {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/portfolio/snapshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to take snapshot');
  return res.json();
},
```

**Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add portfolio performance API methods"
```

---

## Task 6: Create PortfolioChart Component

**Files:**
- Create: `apps/web/src/components/PortfolioChart.tsx`

**Step 1: Create the component**

```typescript
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
                formatter={(value: number) => [formatTooltipValue(value), 'Value']}
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
```

**Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/PortfolioChart.tsx
git commit -m "feat(web): add PortfolioChart component with time period selector"
```

---

## Task 7: Create PositionsTable Component

**Files:**
- Create: `apps/web/src/components/PositionsTable.tsx`

**Step 1: Create the component**

```typescript
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
```

**Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/PositionsTable.tsx
git commit -m "feat(web): add PositionsTable component with sorting"
```

---

## Task 8: Refactor Dashboard Page

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Step 1: Update imports and add new components**

Replace the entire `apps/web/src/app/dashboard/page.tsx` with the refactored version that:
- Adds PortfolioChart at the top
- Adds PositionsTable below the chart
- Fetches positions data for the table
- Reorganizes stat cards and P&L cards
- Combines Capital & Risk section
- Keeps SystemHealth and RecentActivity

The file is large, so implement these changes:

1. Add imports at top:
```typescript
import { PortfolioChart } from '@/components/PortfolioChart';
import { PositionsTable } from '@/components/PositionsTable';
```

2. Add positions state and fetch:
```typescript
const [positions, setPositions] = useState<Position[]>([]);

// In useEffect, add:
api.getPositions(token).then(setPositions).catch(() => {});
```

3. Reorder JSX to:
   - PortfolioChart (hero)
   - PositionsTable
   - Status cards (4 in a row)
   - P&L cards (3 in a row, without progress bars)
   - Capital + System Health (2 columns)
   - Recent Activity

**Step 2: Build frontend**

Run: `cd apps/web && npm run build`
Expected: Build succeeds

**Step 3: Restart and test**

Run: `pm2 restart tradeguard-web`
Test: Open http://localhost:3666/dashboard in browser

**Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): refactor dashboard with hero chart and positions table"
```

---

## Task 9: Take Initial Portfolio Snapshot

**Files:** None (API call only)

**Step 1: Manually trigger first snapshot**

Run: `curl -X POST http://localhost:3667/portfolio/snapshot -H "Authorization: Bearer $(curl -s http://localhost:3667/auth/login -H "Content-Type: application/json" -d '{"email":"danymoussa@gmail.com","password":"!Mila101z"}' | jq -r '.accessToken')" | jq .`

Expected: `{ "success": true, "snapshot": { ... } }`

**Step 2: Verify in browser**

Open dashboard - chart should now have one data point.

---

## Task 10: Final Testing and Polish

**Step 1: Test all time periods**

Click through 1D, 7D, 1M, 3M, 6M, MTD, YTD, ALL in the chart.
Expected: Chart updates (may be empty for longer periods until more data accumulates)

**Step 2: Test positions table sorting**

Click column headers to sort.
Expected: Table re-sorts on click, arrow indicator shows direction.

**Step 3: Test responsive layout**

Resize browser to tablet/mobile widths.
Expected: Cards stack appropriately, table scrolls horizontally.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete dashboard redesign with performance chart"
```

---

## Summary

**Backend tasks:** 1-3 (Entity, Migration, Portfolio Module)
**Frontend tasks:** 4-8 (Recharts, API, Components, Dashboard refactor)
**Testing tasks:** 9-10 (Initial data, verification)

**Total estimated tasks:** 10
**New files:** 6
**Modified files:** 3
