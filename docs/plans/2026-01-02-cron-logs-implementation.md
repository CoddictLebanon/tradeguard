# Cron Job Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a log viewer for the Trailing Stop Daily Reassessment cron job in the Settings Notifications tab.

**Architecture:** New `CronLog` entity stores job executions with JSONB details. `TrailingStopService.dailyReassessment()` creates log records. New controller exposes logs via API. Frontend adds collapsible section in Notifications tab.

**Tech Stack:** NestJS, TypeORM, PostgreSQL (JSONB), Next.js/React

---

### Task 1: Create CronLog Entity

**Files:**
- Create: `apps/api/src/entities/cron-log.entity.ts`

**Step 1: Create the entity file**

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type CronLogStatus = 'running' | 'success' | 'partial' | 'failed';

export interface CronLogDetail {
  positionId: string;
  symbol: string;
  action: 'raised' | 'unchanged' | 'failed';
  oldStopPrice?: number;
  newStopPrice?: number;
  error?: string;
}

@Entity('cron_logs')
export class CronLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  jobName: string;

  @Column({ type: 'varchar', default: 'running' })
  status: CronLogStatus;

  @Column({ type: 'timestamp' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ type: 'int', default: 0 })
  positionsChecked: number;

  @Column({ type: 'int', default: 0 })
  stopsRaised: number;

  @Column({ type: 'int', default: 0 })
  failures: number;

  @Column({ type: 'jsonb', default: [] })
  details: CronLogDetail[];

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

**Step 2: Register entity in AppModule**

Modify: `apps/api/src/app.module.ts`

Add `CronLog` to the TypeORM entities array:
```typescript
import { CronLog } from './entities/cron-log.entity';
// In TypeOrmModule.forRoot entities array, add:
CronLog,
```

**Step 3: Generate and run migration**

Run:
```bash
cd apps/api && npx typeorm migration:generate src/migrations/AddCronLog -d src/data-source.ts
```

Then run:
```bash
npx typeorm migration:run -d src/data-source.ts
```

**Step 4: Commit**

```bash
git add apps/api/src/entities/cron-log.entity.ts apps/api/src/app.module.ts apps/api/src/migrations/
git commit -m "feat(api): add CronLog entity for tracking cron job executions"
```

---

### Task 2: Create CronLog Module with Controller and Service

**Files:**
- Create: `apps/api/src/cron-log/cron-log.service.ts`
- Create: `apps/api/src/cron-log/cron-log.controller.ts`
- Create: `apps/api/src/cron-log/cron-log.module.ts`

**Step 1: Create the service**

```typescript
// apps/api/src/cron-log/cron-log.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronLog, CronLogDetail, CronLogStatus } from '../entities/cron-log.entity';

@Injectable()
export class CronLogService {
  constructor(
    @InjectRepository(CronLog)
    private cronLogRepo: Repository<CronLog>,
  ) {}

  async createLog(jobName: string): Promise<CronLog> {
    const log = this.cronLogRepo.create({
      jobName,
      status: 'running',
      startedAt: new Date(),
      positionsChecked: 0,
      stopsRaised: 0,
      failures: 0,
      details: [],
    });
    return this.cronLogRepo.save(log);
  }

  async addDetail(logId: string, detail: CronLogDetail): Promise<void> {
    const log = await this.cronLogRepo.findOneBy({ id: logId });
    if (!log) return;

    log.details.push(detail);
    log.positionsChecked++;
    if (detail.action === 'raised') log.stopsRaised++;
    if (detail.action === 'failed') log.failures++;

    await this.cronLogRepo.save(log);
  }

  async completeLog(
    logId: string,
    status: CronLogStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.cronLogRepo.update(logId, {
      status,
      completedAt: new Date(),
      errorMessage,
    });
  }

  async getLogs(jobName: string, limit = 50): Promise<CronLog[]> {
    return this.cronLogRepo.find({
      where: { jobName },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }
}
```

**Step 2: Create the controller**

```typescript
// apps/api/src/cron-log/cron-log.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CronLogService } from './cron-log.service';

@Controller('cron-logs')
@UseGuards(JwtAuthGuard)
export class CronLogController {
  constructor(private cronLogService: CronLogService) {}

  @Get()
  async getLogs(
    @Query('jobName') jobName: string = 'trailing_stop_reassessment',
    @Query('limit') limit: string = '50',
  ) {
    const logs = await this.cronLogService.getLogs(jobName, parseInt(limit, 10));
    return { logs };
  }
}
```

**Step 3: Create the module**

```typescript
// apps/api/src/cron-log/cron-log.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronLog } from '../entities/cron-log.entity';
import { CronLogService } from './cron-log.service';
import { CronLogController } from './cron-log.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CronLog])],
  controllers: [CronLogController],
  providers: [CronLogService],
  exports: [CronLogService],
})
export class CronLogModule {}
```

**Step 4: Register module in AppModule**

Modify: `apps/api/src/app.module.ts`

```typescript
import { CronLogModule } from './cron-log/cron-log.module';
// Add to imports array:
CronLogModule,
```

**Step 5: Commit**

```bash
git add apps/api/src/cron-log/ apps/api/src/app.module.ts
git commit -m "feat(api): add CronLog module with service and controller"
```

---

### Task 3: Integrate CronLog into TrailingStopService

**Files:**
- Modify: `apps/api/src/strategy/trailing-stop.service.ts`

**Step 1: Read the current file**

Read `apps/api/src/strategy/trailing-stop.service.ts` to understand the current `dailyReassessment()` implementation.

**Step 2: Import and inject CronLogService**

Add to imports:
```typescript
import { CronLogService } from '../cron-log/cron-log.service';
```

Add to constructor:
```typescript
constructor(
  // ... existing injections
  private cronLogService: CronLogService,
) {}
```

**Step 3: Update StrategyModule to import CronLogModule**

Modify: `apps/api/src/strategy/strategy.module.ts`

```typescript
import { CronLogModule } from '../cron-log/cron-log.module';
// Add to imports array:
CronLogModule,
```

**Step 4: Modify dailyReassessment() to log executions**

Wrap the existing logic to create and update cron logs:

```typescript
@Cron('0 17 * * 1-5', { timeZone: 'America/New_York' })
async dailyReassessment(): Promise<void> {
  this.logger.log('Starting daily trailing stop reassessment');

  const cronLog = await this.cronLogService.createLog('trailing_stop_reassessment');

  try {
    const openPositions = await this.positionRepo.find({
      where: { status: 'open' },
    });

    for (const position of openPositions) {
      try {
        const result = await this.reassessPosition(position);

        await this.cronLogService.addDetail(cronLog.id, {
          positionId: position.id,
          symbol: position.symbol,
          action: result.updated ? 'raised' : 'unchanged',
          oldStopPrice: result.oldStopPrice,
          newStopPrice: result.newStopPrice,
        });
      } catch (error) {
        this.logger.error(`Failed to reassess ${position.symbol}: ${error.message}`);
        await this.cronLogService.addDetail(cronLog.id, {
          positionId: position.id,
          symbol: position.symbol,
          action: 'failed',
          error: error.message,
        });
      }
    }

    const finalStatus = cronLog.failures > 0 ? 'partial' : 'success';
    await this.cronLogService.completeLog(cronLog.id, finalStatus);

    this.logger.log(`Daily reassessment complete: ${cronLog.positionsChecked} positions, ${cronLog.stopsRaised} stops raised`);
  } catch (error) {
    this.logger.error(`Daily reassessment failed: ${error.message}`);
    await this.cronLogService.completeLog(cronLog.id, 'failed', error.message);
  }
}
```

Note: The exact implementation depends on the current structure. The key changes are:
1. Create a cronLog at start
2. Add details for each position processed
3. Complete the log with final status

**Step 5: Verify the build compiles**

Run:
```bash
cd apps/api && npm run build
```

**Step 6: Commit**

```bash
git add apps/api/src/strategy/trailing-stop.service.ts apps/api/src/strategy/strategy.module.ts
git commit -m "feat(api): integrate CronLog into trailing stop daily reassessment"
```

---

### Task 4: Add Frontend API Method

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Add the getCronLogs method**

Add to the `api` object:

```typescript
// Cron Logs
getCronLogs: (token: string, jobName = 'trailing_stop_reassessment', limit = 50) =>
  apiRequest<{
    logs: Array<{
      id: string;
      jobName: string;
      status: 'running' | 'success' | 'partial' | 'failed';
      startedAt: string;
      completedAt: string | null;
      positionsChecked: number;
      stopsRaised: number;
      failures: number;
      details: Array<{
        positionId: string;
        symbol: string;
        action: 'raised' | 'unchanged' | 'failed';
        oldStopPrice?: number;
        newStopPrice?: number;
        error?: string;
      }>;
      errorMessage: string | null;
    }>;
  }>(`/cron-logs?jobName=${jobName}&limit=${limit}`, { token }),
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add getCronLogs API method"
```

---

### Task 5: Add Cron Logs Section to Settings Notifications Tab

**Files:**
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`

**Step 1: Read the current settings page**

Read `apps/web/src/app/dashboard/settings/page.tsx` to understand the Notifications tab structure.

**Step 2: Add state for cron logs**

Add to the component state:

```typescript
const [cronLogs, setCronLogs] = useState<Array<{
  id: string;
  jobName: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string | null;
  positionsChecked: number;
  stopsRaised: number;
  failures: number;
  details: Array<{
    positionId: string;
    symbol: string;
    action: 'raised' | 'unchanged' | 'failed';
    oldStopPrice?: number;
    newStopPrice?: number;
    error?: string;
  }>;
  errorMessage: string | null;
}>>([]);
const [cronLogsLoading, setCronLogsLoading] = useState(false);
const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
```

**Step 3: Add fetch function for cron logs**

```typescript
const fetchCronLogs = useCallback(async () => {
  if (!token) return;
  setCronLogsLoading(true);
  try {
    const result = await api.getCronLogs(token);
    setCronLogs(result.logs);
  } catch (err) {
    console.error('Failed to load cron logs:', err);
  } finally {
    setCronLogsLoading(false);
  }
}, [token]);

// Call when Notifications tab is active
useEffect(() => {
  if (activeTab === 'notifications') {
    fetchCronLogs();
  }
}, [activeTab, fetchCronLogs]);
```

**Step 4: Add helper functions**

```typescript
const toggleLogExpanded = (logId: string) => {
  setExpandedLogs(prev => {
    const next = new Set(prev);
    if (next.has(logId)) {
      next.delete(logId);
    } else {
      next.add(logId);
    }
    return next;
  });
};

const formatLogTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'success': return 'text-green-400';
    case 'partial': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-blue-400';
    default: return 'text-gray-400';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'success': return '✓';
    case 'partial': return '⚠';
    case 'failed': return '✗';
    case 'running': return '⟳';
    default: return '?';
  }
};
```

**Step 5: Add the UI section in Notifications tab**

Add after the existing Telegram notification events section:

```tsx
{/* Cron Job Logs */}
<div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50">
  <h3 className="text-lg font-semibold text-white mb-4">
    Trailing Stop Reassessment Logs
  </h3>

  {cronLogsLoading ? (
    <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
      <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      Loading logs...
    </div>
  ) : cronLogs.length === 0 ? (
    <div className="text-gray-400 text-center py-8">
      No reassessment logs yet. Logs are created daily at 5 PM ET.
    </div>
  ) : (
    <div className="space-y-3 max-h-96 overflow-y-auto">
      {cronLogs.map((log) => (
        <div
          key={log.id}
          className="bg-gray-700/50 rounded-lg border border-gray-600/50 overflow-hidden"
        >
          {/* Header - always visible */}
          <button
            onClick={() => toggleLogExpanded(log.id)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className={`text-lg ${getStatusColor(log.status)}`}>
                {getStatusIcon(log.status)}
              </span>
              <div className="text-left">
                <div className="text-white font-medium">
                  {formatLogTime(log.startedAt)}
                </div>
                <div className="text-gray-400 text-sm">
                  {log.positionsChecked} positions • {log.stopsRaised} raised • {log.failures} failures
                </div>
              </div>
            </div>
            <span className="text-gray-400">
              {expandedLogs.has(log.id) ? '▼' : '▶'}
            </span>
          </button>

          {/* Details - expandable */}
          {expandedLogs.has(log.id) && (
            <div className="px-4 pb-3 border-t border-gray-600/50">
              {log.errorMessage && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {log.errorMessage}
                </div>
              )}

              {log.details.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {log.details.map((detail, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <span className="text-white font-medium">{detail.symbol}</span>
                      {detail.action === 'raised' ? (
                        <span className="text-green-400">
                          ${detail.oldStopPrice?.toFixed(2)} → ${detail.newStopPrice?.toFixed(2)}
                        </span>
                      ) : detail.action === 'failed' ? (
                        <span className="text-red-400">{detail.error || 'Failed'}</span>
                      ) : (
                        <span className="text-gray-500">unchanged</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-gray-500 text-sm">
                  No positions to reassess
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )}
</div>
```

**Step 6: Verify the build compiles**

Run:
```bash
cd apps/web && npm run build
```

**Step 7: Commit**

```bash
git add apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat(web): add cron job logs section to Notifications settings tab"
```

---

### Task 6: Final Build and Test

**Step 1: Run full build**

```bash
cd /home/xcoder/Desktop/Claude/TradeGuard && npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Start the servers**

```bash
cd apps/api && npm run dev &
cd apps/web && npm run dev &
```

**Step 3: Manual verification**

1. Open http://localhost:666/dashboard/settings
2. Go to Notifications tab
3. Scroll to "Trailing Stop Reassessment Logs" section
4. Verify it shows "No reassessment logs yet" or existing logs if any
5. If logs exist, click one to expand and verify details show correctly

**Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: adjustments from manual testing"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create CronLog entity and run migration |
| 2 | Create CronLog module (service + controller) |
| 3 | Integrate logging into TrailingStopService.dailyReassessment() |
| 4 | Add getCronLogs API method to frontend |
| 5 | Add cron logs UI section in Settings Notifications tab |
| 6 | Final build verification and testing |
