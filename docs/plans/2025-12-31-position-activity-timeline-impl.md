# Position Activity Timeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show position lifecycle events (open, stop changes, close) in a slide-out drawer when clicking a position row.

**Architecture:** Add `positionId` column to ActivityLog entity, create endpoint to fetch activities by position, build React drawer component with timeline UI.

**Tech Stack:** NestJS, TypeORM, React, TailwindCSS

---

### Task 1: Add positionId Column to ActivityLog Entity

**Files:**
- Modify: `apps/api/src/entities/activity-log.entity.ts:20-36`

**Step 1: Add positionId column**

Edit `apps/api/src/entities/activity-log.entity.ts` to add the new column:

```typescript
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ActivityType {
  OPPORTUNITY_CREATED = 'opportunity_created',
  OPPORTUNITY_APPROVED = 'opportunity_approved',
  OPPORTUNITY_REJECTED = 'opportunity_rejected',
  ORDER_PLACED = 'order_placed',
  ORDER_FILLED = 'order_filled',
  STOP_TRIGGERED = 'stop_triggered',
  POSITION_OPENED = 'position_opened',
  POSITION_CLOSED = 'position_closed',
  TRADE_BLOCKED = 'trade_blocked',
  CIRCUIT_BREAKER = 'circuit_breaker',
  SETTING_CHANGED = 'setting_changed',
  TRAILING_STOP_UPDATED = 'trailing_stop_updated',
  SYSTEM = 'system',
}

@Entity('activity_log')
export class ActivityLog extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ActivityType,
  })
  type: ActivityType;

  @Column()
  message: string;

  @Column('jsonb', { nullable: true })
  details: Record<string, any>;

  @Column({ nullable: true })
  symbol: string;

  @Column({ nullable: true })
  positionId: string;
}
```

**Step 2: Verify app starts (TypeORM auto-syncs in dev)**

Run: `cd apps/api && npm run start:dev`
Expected: App starts without errors, column is auto-created

**Step 3: Commit**

```bash
git add apps/api/src/entities/activity-log.entity.ts
git commit -m "feat: add positionId column to ActivityLog entity"
```

---

### Task 2: Update TrailingStopService to Include positionId

**Files:**
- Modify: `apps/api/src/strategy/trailing-stop.service.ts:202-206`

**Step 1: Add positionId to activity log save**

In `reassessPosition()` method, update the activity save at line 202-206:

Find this code:
```typescript
        await this.activityRepo.save({
          type: ActivityType.TRAILING_STOP_UPDATED,
          message: `Stop raised for ${position.symbol}: $${currentStop.toFixed(2)} → $${analysis.newStopPrice.toFixed(2)}`,
          details: update,
        });
```

Replace with:
```typescript
        await this.activityRepo.save({
          type: ActivityType.TRAILING_STOP_UPDATED,
          positionId: position.id,
          symbol: position.symbol,
          message: `Stop raised for ${position.symbol}: $${currentStop.toFixed(2)} → $${analysis.newStopPrice.toFixed(2)}`,
          details: update,
        });
```

**Step 2: Commit**

```bash
git add apps/api/src/strategy/trailing-stop.service.ts
git commit -m "feat: include positionId in trailing stop activity logs"
```

---

### Task 3: Update IBEventsService to Include positionId at Top Level

**Files:**
- Modify: `apps/api/src/ib/ib-events.service.ts:104-109`

**Step 1: Add positionId to POSITION_OPENED activity (entry fill)**

The code at line 104-109 already has positionId in details. Add it as a top-level column:

Find this code:
```typescript
      await this.activityRepo.save({
        type: ActivityType.ORDER_FILLED,
        message: `Opened position: ${entryPosition.shares} ${entryPosition.symbol} @ $${event.avgFillPrice}`,
        symbol: entryPosition.symbol,
        details: { positionId: entryPosition.id, avgFillPrice: event.avgFillPrice },
      });
```

Replace with:
```typescript
      await this.activityRepo.save({
        type: ActivityType.POSITION_OPENED,
        positionId: entryPosition.id,
        symbol: entryPosition.symbol,
        message: `Opened position: ${entryPosition.shares} ${entryPosition.symbol} @ $${event.avgFillPrice}`,
        details: {
          entryPrice: event.avgFillPrice,
          shares: entryPosition.shares,
          stopPrice: entryPosition.stopPrice,
        },
      });
```

**Step 2: Verify POSITION_CLOSED already has positionId in details**

Check line 155-160. The code saves `positionId: position.id` in details. Add it as top-level:

Find this code:
```typescript
      await manager.save(ActivityLog, {
        type: ActivityType.POSITION_CLOSED,
        message: `Closed ${position.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
        symbol: position.symbol,
        details: { positionId: position.id, exitPrice, pnl, pnlPercent, exitReason },
      });
```

Replace with:
```typescript
      await manager.save(ActivityLog, {
        type: ActivityType.POSITION_CLOSED,
        positionId: position.id,
        symbol: position.symbol,
        message: `Closed ${position.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
        details: { exitPrice, pnl, pnlPercent, exitReason },
      });
```

**Step 3: Commit**

```bash
git add apps/api/src/ib/ib-events.service.ts
git commit -m "feat: add positionId to position open/close activity logs"
```

---

### Task 4: Add Activity Endpoint to PositionsController

**Files:**
- Modify: `apps/api/src/positions/positions.module.ts`
- Modify: `apps/api/src/positions/positions.controller.ts`

**Step 1: Import ActivityLog in PositionsModule**

Edit `apps/api/src/positions/positions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { Position } from '../entities/position.entity';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Position, ActivityLog])],
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
```

**Step 2: Add activity endpoint to PositionsController**

Edit `apps/api/src/positions/positions.controller.ts`:

```typescript
import { Controller, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { ActivityLog } from '../entities/activity-log.entity';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(
    private readonly positionsService: PositionsService,
    @InjectRepository(ActivityLog)
    private readonly activityRepo: Repository<ActivityLog>,
  ) {}

  @Get()
  async getPositions() {
    return this.positionsService.findOpen();
  }

  @Get('all')
  async getAllPositions() {
    return this.positionsService.findAll();
  }

  @Get('stats')
  async getStats() {
    return this.positionsService.getPositionStats();
  }

  @Get(':id')
  async getPosition(@Param('id') id: string) {
    return this.positionsService.findById(id);
  }

  @Get(':id/activity')
  async getPositionActivity(@Param('id') id: string) {
    return this.activityRepo.find({
      where: { positionId: id },
      order: { createdAt: 'ASC' },
    });
  }

  @Post(':id/close')
  async closePosition(@Param('id') id: string) {
    const result = await this.positionsService.closePosition(id);
    return { success: !!result };
  }

  @Put(':id/trail')
  async updateTrailPercent(
    @Param('id') id: string,
    @Body() body: { trailPercent: number },
  ) {
    const result = await this.positionsService.updateTrailPercent(id, body.trailPercent);
    return { success: !!result };
  }
}
```

**Step 3: Test endpoint manually**

Run: `curl -H "Authorization: Bearer <token>" http://localhost:667/positions/<id>/activity`
Expected: Returns array of activities (may be empty if no activities exist for that position)

**Step 4: Commit**

```bash
git add apps/api/src/positions/positions.module.ts apps/api/src/positions/positions.controller.ts
git commit -m "feat: add GET /positions/:id/activity endpoint"
```

---

### Task 5: Add API Method for Position Activity

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Add getPositionActivity method**

Add after the `closePosition` method (around line 151):

Find this section:
```typescript
  closePosition: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/positions/${id}/close`, {
      method: 'POST',
      token,
    }),
```

Add after it:
```typescript
  getPositionActivity: (token: string, id: string) =>
    apiRequest<Array<{
      id: string;
      type: string;
      message: string;
      details: Record<string, unknown>;
      symbol: string;
      positionId: string;
      createdAt: string;
    }>>(`/positions/${id}/activity`, { token }),
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add getPositionActivity API method"
```

---

### Task 6: Create PositionActivityDrawer Component

**Files:**
- Create: `apps/web/src/components/PositionActivityDrawer.tsx`

**Step 1: Create the drawer component**

Create `apps/web/src/components/PositionActivityDrawer.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Activity {
  id: string;
  type: string;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
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

export function PositionActivityDrawer({ position, onClose }: Props) {
  const token = useAuthStore((state) => state.token);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!position || !token) return;

    setLoading(true);
    api
      .getPositionActivity(token, position.id)
      .then(setActivities)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [position, token]);

  if (!position) return null;

  const entryPrice = Number(position.entryPrice);
  const currentPrice = Number(position.currentPrice);
  const stopPrice = Number(position.stopPrice) || 0;
  const pnl = (currentPrice - entryPrice) * position.shares;
  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 bg-gray-900 border-l border-gray-700 z-50 overflow-y-auto">
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
    </>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/PositionActivityDrawer.tsx
git commit -m "feat: add PositionActivityDrawer component"
```

---

### Task 7: Add Drawer to Positions Page

**Files:**
- Modify: `apps/web/src/app/dashboard/positions/page.tsx`

**Step 1: Import drawer and add state**

Replace the entire file with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { PositionActivityDrawer } from '@/components/PositionActivityDrawer';

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
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  const fetchPositions = async () => {
    if (!token) return;
    try {
      const data: PositionRaw[] = await api.getPositions(token);
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

  useEffect(() => {
    if (positions.length === 0) return;
    const fluctuateInterval = setInterval(() => {
      setPositions(prev => prev.map(pos => {
        const fluctuation = 1 + (Math.random() - 0.5) * 0.003;
        const newPrice = pos.currentPrice * fluctuation;
        const unrealizedPnl = (newPrice - Number(pos.entryPrice)) * pos.shares;
        const unrealizedPnlPercent = ((newPrice - Number(pos.entryPrice)) / Number(pos.entryPrice)) * 100;
        return { ...pos, currentPrice: newPrice, unrealizedPnl, unrealizedPnlPercent };
      }));
    }, 1000);
    return () => clearInterval(fluctuateInterval);
  }, [positions.length]);

  const handleClose = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-medium w-24">Symbol</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-20">Shares</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-28">Capital</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Entry</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Current</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Stop</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-20">Stop %</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-36">P/L</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const capital = pos.shares * Number(pos.entryPrice);
                const stopPct = ((Number(pos.entryPrice) - Number(pos.stopPrice)) / Number(pos.entryPrice)) * 100;
                return (
                  <tr
                    key={pos.id}
                    onClick={() => setSelectedPosition(pos)}
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                  >
                    <td className="py-4 px-4 font-medium text-white">{pos.symbol}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">{pos.shares}</td>
                    <td className="py-4 px-4 text-right text-blue-400 font-medium tabular-nums">${capital.toLocaleString()}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">${Number(pos.entryPrice).toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">${pos.currentPrice.toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-red-400 tabular-nums">${Number(pos.stopPrice).toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-yellow-400 tabular-nums">{stopPct.toFixed(2)}%</td>
                    <td className={`py-4 px-4 text-right font-medium tabular-nums ${pos.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      <span className="text-xs ml-1">({pos.unrealizedPnlPercent.toFixed(1)}%)</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={(e) => handleClose(pos.id, e)}
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

      <PositionActivityDrawer
        position={selectedPosition}
        onClose={() => setSelectedPosition(null)}
      />
    </div>
  );
}
```

**Step 2: Test the UI**

Run: `cd apps/web && npm run dev`
Navigate to: `http://localhost:3000/dashboard/positions`
Click on a position row
Expected: Drawer slides in from right showing position details and activity timeline

**Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/positions/page.tsx
git commit -m "feat: integrate position activity drawer into positions page"
```

---

### Task 8: Final Verification

**Step 1: Start both services**

Terminal 1: `cd apps/api && npm run start:dev`
Terminal 2: `cd apps/web && npm run dev`

**Step 2: Test the full flow**

1. Navigate to Positions page
2. Click on any position row
3. Verify drawer opens with position summary
4. Verify activity timeline shows (or shows "No activity recorded yet" for new positions)
5. Click backdrop or X to close drawer

**Step 3: Final commit with all changes**

```bash
git add .
git commit -m "feat: complete position activity timeline feature"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add positionId column to ActivityLog | `activity-log.entity.ts` |
| 2 | Update TrailingStopService to include positionId | `trailing-stop.service.ts` |
| 3 | Update IBEventsService for position open/close | `ib-events.service.ts` |
| 4 | Add activity endpoint to PositionsController | `positions.module.ts`, `positions.controller.ts` |
| 5 | Add API method for position activity | `api.ts` |
| 6 | Create PositionActivityDrawer component | `PositionActivityDrawer.tsx` |
| 7 | Integrate drawer into positions page | `positions/page.tsx` |
| 8 | Final verification | - |
