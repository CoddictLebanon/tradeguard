# Health & Reliability System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified health monitoring and reconciliation system that keeps IB and database in sync, provides real-time health visibility, and alerts via Telegram when issues occur.

**Architecture:** New HealthModule in NestJS with HealthService (checks), ReconciliationService (sync), and HealthController (API). Frontend displays health status on dashboard. Uses existing TelegramModule for alerts.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, React/Next.js, Tailwind CSS

---

## Task 1: Create HealthLog Entity

**Files:**
- Create: `apps/api/src/health/entities/health-log.entity.ts`

**Step 1: Create the entity file**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  CRITICAL = 'critical',
}

export enum HealthComponent {
  IB_GATEWAY = 'ib_gateway',
  IB_PROXY = 'ib_proxy',
  DATABASE = 'database',
  POSITION_SYNC = 'position_sync',
  CRON_JOBS = 'cron_jobs',
}

@Entity('health_logs')
export class HealthLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn()
  timestamp: Date;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  component: HealthComponent;

  @Column({ type: 'varchar', length: 20 })
  status: HealthStatus;

  @Column({ type: 'int', nullable: true })
  responseTime: number | null;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;
}
```

**Step 2: Verify file created correctly**

Run: `cat apps/api/src/health/entities/health-log.entity.ts | head -20`
Expected: Entity code visible

**Step 3: Commit**

```bash
git add apps/api/src/health/entities/health-log.entity.ts
git commit -m "feat(health): add HealthLog entity"
```

---

## Task 2: Create Health Module Structure

**Files:**
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/reconciliation.service.ts`

**Step 1: Create HealthService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HealthLog, HealthStatus, HealthComponent } from './entities/health-log.entity';
import { IBService } from '../ib/ib.service';
import { TelegramService } from '../telegram/telegram.service';

export interface ComponentHealth {
  status: HealthStatus;
  responseTime?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  status: HealthStatus;
  timestamp: Date;
  components: {
    ibGateway: ComponentHealth;
    ibProxy: ComponentHealth;
    database: ComponentHealth;
    positionSync: ComponentHealth;
    cronJobs: ComponentHealth;
  };
  lastReconciliation: Date | null;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private lastStatus: HealthStatus = HealthStatus.HEALTHY;
  private lastReconciliation: Date | null = null;
  private lastAlerts: Map<string, Date> = new Map();
  private readonly ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(HealthLog)
    private healthLogRepo: Repository<HealthLog>,
    private readonly ibService: IBService,
    private readonly telegramService: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async runHealthChecks(): Promise<SystemHealth> {
    this.logger.debug('Running health checks...');

    const [ibGateway, ibProxy, database, positionSync, cronJobs] = await Promise.all([
      this.checkIBGateway(),
      this.checkIBProxy(),
      this.checkDatabase(),
      this.checkPositionSync(),
      this.checkCronJobs(),
    ]);

    const components = { ibGateway, ibProxy, database, positionSync, cronJobs };

    // Determine overall status
    const statuses = Object.values(components).map(c => c.status);
    let overallStatus = HealthStatus.HEALTHY;
    if (statuses.includes(HealthStatus.CRITICAL)) {
      overallStatus = HealthStatus.CRITICAL;
    } else if (statuses.includes(HealthStatus.DEGRADED)) {
      overallStatus = HealthStatus.DEGRADED;
    }

    // Log each component status
    for (const [name, health] of Object.entries(components)) {
      await this.logHealth(name as HealthComponent, health);
    }

    // Alert on status change
    if (overallStatus !== this.lastStatus) {
      await this.sendStatusChangeAlert(overallStatus, components);
      this.lastStatus = overallStatus;
    }

    return {
      status: overallStatus,
      timestamp: new Date(),
      components,
      lastReconciliation: this.lastReconciliation,
    };
  }

  private async checkIBGateway(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const positions = await this.ibService.getPositionsFromProxy();
      const responseTime = Date.now() - start;

      if (responseTime > 10000) {
        return { status: HealthStatus.DEGRADED, responseTime, message: 'Slow response' };
      }

      return { status: HealthStatus.HEALTHY, responseTime, message: 'Connected' };
    } catch (error) {
      return {
        status: HealthStatus.CRITICAL,
        responseTime: Date.now() - start,
        message: 'Disconnected',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkIBProxy(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const response = await fetch('http://localhost:5001/health', {
        signal: AbortSignal.timeout(5000),
      });
      const responseTime = Date.now() - start;

      if (response.ok) {
        return { status: HealthStatus.HEALTHY, responseTime };
      }
      return { status: HealthStatus.CRITICAL, responseTime, message: 'Unhealthy response' };
    } catch (error) {
      return {
        status: HealthStatus.CRITICAL,
        responseTime: Date.now() - start,
        message: 'Not reachable',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      await this.healthLogRepo.query('SELECT 1');
      const responseTime = Date.now() - start;

      if (responseTime > 2000) {
        return { status: HealthStatus.DEGRADED, responseTime, message: 'Slow' };
      }

      return { status: HealthStatus.HEALTHY, responseTime };
    } catch (error) {
      return {
        status: HealthStatus.CRITICAL,
        responseTime: Date.now() - start,
        message: 'Unreachable',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkPositionSync(): Promise<ComponentHealth> {
    try {
      const ibPositions = await this.ibService.getPositionsFromProxy();
      const dbResult = await this.healthLogRepo.query(
        `SELECT COUNT(*) as count FROM positions WHERE status = 'open'`
      );
      const ibCount = ibPositions.length;
      const dbCount = parseInt(dbResult[0].count, 10);

      if (ibCount === dbCount) {
        return {
          status: HealthStatus.HEALTHY,
          message: 'In sync',
          details: { ibCount, dbCount },
        };
      }

      return {
        status: HealthStatus.DEGRADED,
        message: `Mismatch: IB=${ibCount}, DB=${dbCount}`,
        details: { ibCount, dbCount },
      };
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: 'Unable to check',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkCronJobs(): Promise<ComponentHealth> {
    try {
      const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000);
      const recentLogs = await this.healthLogRepo.query(
        `SELECT * FROM cron_logs WHERE job_name = 'trailing_stop_reassessment' AND executed_at > $1 ORDER BY executed_at DESC LIMIT 1`,
        [thirtyFiveMinutesAgo]
      );

      if (recentLogs.length > 0) {
        return {
          status: HealthStatus.HEALTHY,
          message: 'Running',
          details: { lastRun: recentLogs[0].executed_at },
        };
      }

      // Check if multiple runs missed
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const olderLogs = await this.healthLogRepo.query(
        `SELECT * FROM cron_logs WHERE job_name = 'trailing_stop_reassessment' AND executed_at > $1 ORDER BY executed_at DESC LIMIT 1`,
        [twoHoursAgo]
      );

      if (olderLogs.length === 0) {
        return { status: HealthStatus.CRITICAL, message: 'Multiple runs missed' };
      }

      return {
        status: HealthStatus.DEGRADED,
        message: 'Missed last run',
        details: { lastRun: olderLogs[0]?.executed_at },
      };
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: 'Unable to check',
        details: { error: (error as Error).message },
      };
    }
  }

  private async logHealth(component: HealthComponent, health: ComponentHealth): Promise<void> {
    try {
      await this.healthLogRepo.save({
        component,
        status: health.status,
        responseTime: health.responseTime,
        details: health.details,
      });
    } catch (error) {
      this.logger.error(`Failed to log health: ${(error as Error).message}`);
    }
  }

  private async sendStatusChangeAlert(
    newStatus: HealthStatus,
    components: Record<string, ComponentHealth>,
  ): Promise<void> {
    const alertKey = `status_${newStatus}`;
    const lastAlert = this.lastAlerts.get(alertKey);

    if (lastAlert && Date.now() - lastAlert.getTime() < this.ALERT_COOLDOWN_MS) {
      return; // Rate limited
    }

    let emoji = '🟢';
    let message = 'System healthy';

    if (newStatus === HealthStatus.CRITICAL) {
      emoji = '🔴';
      const critical = Object.entries(components)
        .filter(([, h]) => h.status === HealthStatus.CRITICAL)
        .map(([name, h]) => `${name}: ${h.message}`)
        .join(', ');
      message = `CRITICAL: ${critical}`;
    } else if (newStatus === HealthStatus.DEGRADED) {
      emoji = '🟡';
      const degraded = Object.entries(components)
        .filter(([, h]) => h.status === HealthStatus.DEGRADED)
        .map(([name, h]) => `${name}: ${h.message}`)
        .join(', ');
      message = `DEGRADED: ${degraded}`;
    } else {
      message = 'RECOVERED: All systems healthy';
    }

    try {
      await this.telegramService.sendMessage(`${emoji} ${message}`);
      this.lastAlerts.set(alertKey, new Date());
    } catch (error) {
      this.logger.error(`Failed to send alert: ${(error as Error).message}`);
    }
  }

  setLastReconciliation(date: Date): void {
    this.lastReconciliation = date;
  }

  async getHealthHistory(hours: number = 24): Promise<HealthLog[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.healthLogRepo.find({
      where: { timestamp: MoreThan(since) },
      order: { timestamp: 'DESC' },
      take: 1000,
    });
  }

  async cleanupOldLogs(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.healthLogRepo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :date', { date: sevenDaysAgo })
      .execute();
    return result.affected || 0;
  }
}
```

**Step 2: Create ReconciliationService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Position, PositionStatus } from '../entities/position.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { IBService } from '../ib/ib.service';
import { PolygonService } from '../data/polygon.service';
import { TelegramService } from '../telegram/telegram.service';
import { HealthService } from './health.service';

export interface ReconciliationResult {
  synced: string[];
  closed: string[];
  updated: string[];
  errors: string[];
  dryRun: boolean;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private isRunning = false;
  private lastRun: Date | null = null;
  private readonly MIN_INTERVAL_MS = 60 * 1000; // 1 minute

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly ibService: IBService,
    private readonly polygonService: PolygonService,
    private readonly telegramService: TelegramService,
    private readonly healthService: HealthService,
  ) {}

  // Run every 5 minutes during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  @Cron('*/5 9-16 * * 1-5', { timeZone: 'America/New_York' })
  async scheduledReconciliation(): Promise<void> {
    // Only run during actual market hours (after 9:30)
    const now = new Date();
    const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    const etMinute = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));

    if (etHour === 9 && etMinute < 30) {
      return; // Before 9:30 AM ET
    }

    await this.reconcile(false);
  }

  async reconcile(dryRun: boolean = false): Promise<ReconciliationResult> {
    // Rate limiting
    if (this.lastRun && Date.now() - this.lastRun.getTime() < this.MIN_INTERVAL_MS) {
      this.logger.warn('Reconciliation rate limited');
      return { synced: [], closed: [], updated: [], errors: ['Rate limited'], dryRun };
    }

    // Prevent concurrent runs
    if (this.isRunning) {
      this.logger.warn('Reconciliation already running');
      return { synced: [], closed: [], updated: [], errors: ['Already running'], dryRun };
    }

    this.isRunning = true;
    this.lastRun = new Date();

    const result: ReconciliationResult = {
      synced: [],
      closed: [],
      updated: [],
      errors: [],
      dryRun,
    };

    try {
      this.logger.log(`Starting reconciliation (dryRun: ${dryRun})`);

      // Fetch IB positions
      const ibPositions = await this.ibService.getPositionsFromProxy();
      const ibMap = new Map(ibPositions.map(p => [p.symbol, p]));

      // Fetch DB positions
      const dbPositions = await this.positionRepo.find({
        where: { status: PositionStatus.OPEN },
      });
      const dbMap = new Map(dbPositions.map(p => [p.symbol, p]));

      // Fetch live prices for new positions
      const livePrices = new Map<string, number>();
      for (const ibPos of ibPositions) {
        if (!dbMap.has(ibPos.symbol)) {
          try {
            const quote = await this.polygonService.getQuote(ibPos.symbol);
            livePrices.set(ibPos.symbol, quote.price);
          } catch {
            // Use avgCost as fallback
          }
        }
      }

      // Find positions in IB but not in DB (need to sync)
      for (const [symbol, ibPos] of ibMap) {
        if (!dbMap.has(symbol) && ibPos.position > 0) {
          this.logger.log(`Found missing position: ${symbol}`);

          if (!dryRun) {
            try {
              const currentPrice = livePrices.get(symbol) ?? ibPos.avgCost;
              const defaultStopPercent = 0.05;
              const stopPrice = ibPos.avgCost * (1 - defaultStopPercent);

              const position = this.positionRepo.create({
                symbol,
                shares: Math.round(ibPos.position),
                entryPrice: ibPos.avgCost,
                currentPrice,
                highestPrice: currentPrice,
                stopPrice,
                trailPercent: defaultStopPercent * 100,
                status: PositionStatus.OPEN,
                openedAt: new Date(),
              });

              await this.positionRepo.save(position);

              await this.activityRepo.save({
                type: ActivityType.SYSTEM,
                positionId: position.id,
                symbol,
                message: `Reconciliation: Synced missing position ${symbol}`,
                details: { source: 'reconciliation', shares: Math.round(ibPos.position), avgCost: ibPos.avgCost },
              });

              result.synced.push(symbol);
            } catch (error) {
              result.errors.push(`Failed to sync ${symbol}: ${(error as Error).message}`);
            }
          } else {
            result.synced.push(symbol);
          }
        }
      }

      // Find positions in DB but not in IB (need to close)
      for (const [symbol, dbPos] of dbMap) {
        if (!ibMap.has(symbol)) {
          this.logger.log(`Found stale position: ${symbol}`);

          if (!dryRun) {
            try {
              dbPos.status = PositionStatus.CLOSED;
              dbPos.closedAt = new Date();
              await this.positionRepo.save(dbPos);

              await this.activityRepo.save({
                type: ActivityType.SYSTEM,
                positionId: dbPos.id,
                symbol,
                message: `Reconciliation: Closed stale position ${symbol} (not in IB)`,
                details: { source: 'reconciliation' },
              });

              result.closed.push(symbol);
            } catch (error) {
              result.errors.push(`Failed to close ${symbol}: ${(error as Error).message}`);
            }
          } else {
            result.closed.push(symbol);
          }
        }
      }

      // Find positions that exist in both but have different shares/price
      for (const [symbol, ibPos] of ibMap) {
        const dbPos = dbMap.get(symbol);
        if (dbPos && ibPos.position > 0) {
          const ibShares = Math.round(ibPos.position);
          const dbShares = dbPos.shares;

          if (ibShares !== dbShares || Math.abs(ibPos.avgCost - Number(dbPos.entryPrice)) > 0.01) {
            this.logger.log(`Position mismatch for ${symbol}: IB=${ibShares}@${ibPos.avgCost}, DB=${dbShares}@${dbPos.entryPrice}`);

            if (!dryRun) {
              dbPos.shares = ibShares;
              dbPos.entryPrice = ibPos.avgCost;
              await this.positionRepo.save(dbPos);
              result.updated.push(symbol);
            } else {
              result.updated.push(symbol);
            }
          }
        }
      }

      // Send Telegram alert if changes were made
      if (!dryRun && (result.synced.length > 0 || result.closed.length > 0)) {
        const messages: string[] = [];
        if (result.synced.length > 0) {
          messages.push(`Synced: ${result.synced.join(', ')}`);
        }
        if (result.closed.length > 0) {
          messages.push(`Closed: ${result.closed.join(', ')}`);
        }
        await this.telegramService.sendMessage(`🔄 RECONCILED: ${messages.join(' | ')}`);
      }

      // Update health service
      if (!dryRun) {
        this.healthService.setLastReconciliation(new Date());
      }

      this.logger.log(`Reconciliation complete: synced=${result.synced.length}, closed=${result.closed.length}, updated=${result.updated.length}`);

    } catch (error) {
      result.errors.push(`Reconciliation failed: ${(error as Error).message}`);
      this.logger.error(`Reconciliation error: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  async runOnStartup(): Promise<void> {
    this.logger.log('Running startup reconciliation...');
    // Wait for services to initialize
    await new Promise(resolve => setTimeout(resolve, 10000));
    await this.reconcile(false);
  }
}
```

**Step 3: Create HealthController**

```typescript
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HealthService, SystemHealth } from './health.service';
import { ReconciliationService, ReconciliationResult } from './reconciliation.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  // Public endpoint for uptime monitors
  @Get()
  async getQuickHealth(): Promise<{ status: string }> {
    const health = await this.healthService.runHealthChecks();
    return { status: health.status };
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard)
  async getDetailedHealth(): Promise<SystemHealth> {
    return this.healthService.runHealthChecks();
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getHealthHistory(@Query('hours') hours?: string) {
    const hoursNum = hours ? parseInt(hours, 10) : 24;
    return this.healthService.getHealthHistory(hoursNum);
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  async triggerReconciliation(
    @Query('dryRun') dryRun?: string,
  ): Promise<ReconciliationResult> {
    const isDryRun = dryRun === 'true';
    return this.reconciliationService.reconcile(isDryRun);
  }
}
```

**Step 4: Create HealthModule**

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthLog } from './entities/health-log.entity';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { ReconciliationService } from './reconciliation.service';
import { Position } from '../entities/position.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { IBModule } from '../ib/ib.module';
import { DataModule } from '../data/data.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HealthLog, Position, ActivityLog]),
    IBModule,
    DataModule,
    TelegramModule,
  ],
  controllers: [HealthController],
  providers: [HealthService, ReconciliationService],
  exports: [HealthService, ReconciliationService],
})
export class HealthModule implements OnModuleInit {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  onModuleInit() {
    // Run reconciliation on startup
    this.reconciliationService.runOnStartup();
  }
}
```

**Step 5: Verify all files created**

Run: `ls -la apps/api/src/health/`
Expected: health.module.ts, health.service.ts, health.controller.ts, reconciliation.service.ts, entities/

**Step 6: Commit**

```bash
git add apps/api/src/health/
git commit -m "feat(health): add HealthModule with service, controller, and reconciliation"
```

---

## Task 3: Register HealthModule in AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

**Step 1: Add HealthModule import**

Add to imports array:
```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ... existing imports
    HealthModule,
  ],
})
```

**Step 2: Verify build passes**

Run: `cd apps/api && npm run build`
Expected: Build succeeds without errors

**Step 3: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(health): register HealthModule in AppModule"
```

---

## Task 4: Add TypeORM Migration for health_logs Table

**Files:**
- Create: Migration file via TypeORM CLI

**Step 1: Generate migration**

Run: `cd apps/api && npx typeorm migration:generate src/migrations/AddHealthLogs -d src/data-source.ts`

If that fails, create manually:

```typescript
// apps/api/src/migrations/TIMESTAMP-AddHealthLogs.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHealthLogs1704499200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE health_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        component VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        response_time INTEGER,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_health_logs_timestamp ON health_logs(timestamp);
      CREATE INDEX idx_health_logs_component ON health_logs(component);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE health_logs`);
  }
}
```

**Step 2: Run migration**

Run: `cd apps/api && npx typeorm migration:run -d src/data-source.ts`

Or manually:
```sql
CREATE TABLE health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_time INTEGER,
  details JSONB
);

CREATE INDEX idx_health_logs_timestamp ON health_logs(timestamp);
CREATE INDEX idx_health_logs_component ON health_logs(component);
```

**Step 3: Verify table exists**

Run: `PGPASSWORD=boardmeeting123 psql "postgresql://danymoussa:boardmeeting123@localhost:5432/tradeguard" -c "\d health_logs"`
Expected: Table structure displayed

**Step 4: Commit**

```bash
git add apps/api/src/migrations/
git commit -m "feat(health): add health_logs table migration"
```

---

## Task 5: Add API Client Method for Health

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Add health methods to API client**

```typescript
// Add to the api object
getHealthDetailed: async (token: string) => {
  const res = await fetch(`${API_BASE}/health/detailed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch health status');
  return res.json();
},

triggerReconciliation: async (token: string, dryRun: boolean = false) => {
  const res = await fetch(`${API_BASE}/health/reconcile?dryRun=${dryRun}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to trigger reconciliation');
  return res.json();
},
```

**Step 2: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add health API client methods"
```

---

## Task 6: Create SystemHealth Component

**Files:**
- Create: `apps/web/src/components/SystemHealth.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'critical';
  responseTime?: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface SystemHealthData {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  components: {
    ibGateway: ComponentHealth;
    ibProxy: ComponentHealth;
    database: ComponentHealth;
    positionSync: ComponentHealth;
    cronJobs: ComponentHealth;
  };
  lastReconciliation: string | null;
}

const statusColors = {
  healthy: 'text-green-500',
  degraded: 'text-yellow-500',
  critical: 'text-red-500',
};

const statusDots = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const componentLabels: Record<string, string> = {
  ibGateway: 'IB Gateway',
  ibProxy: 'IB Proxy',
  database: 'Database',
  positionSync: 'Position Sync',
  cronJobs: 'Trailing Stops',
};

export function SystemHealth() {
  const token = useAuthStore((state) => state.token);
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const fetchHealth = async () => {
    if (!token) return;
    try {
      const data = await api.getHealthDetailed(token);
      setHealth(data);
      setLastCheck(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const handleReconcile = async () => {
    if (!token || reconciling) return;
    setReconciling(true);
    try {
      const result = await api.triggerReconciliation(token, false);
      if (result.synced.length > 0 || result.closed.length > 0) {
        alert(`Reconciliation complete!\nSynced: ${result.synced.join(', ') || 'none'}\nClosed: ${result.closed.join(', ') || 'none'}`);
      } else {
        alert('All positions already in sync.');
      }
      await fetchHealth();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          Loading health status...
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-red-500/50">
        <div className="text-red-400">Failed to load health status: {error}</div>
      </div>
    );
  }

  const timeSinceCheck = lastCheck
    ? Math.round((Date.now() - lastCheck.getTime()) / 1000)
    : null;

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h3 className="text-white font-medium flex items-center gap-2">
          System Health
        </h3>
        <div className={`w-3 h-3 rounded-full ${statusDots[health.status]}`} />
      </div>

      <div className="divide-y divide-gray-700/50">
        {Object.entries(health.components).map(([key, component]) => (
          <div key={key} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${statusDots[component.status]}`} />
              <span className="text-gray-300">{componentLabels[key] || key}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm ${statusColors[component.status]}`}>
                {component.message || component.status}
              </span>
              {component.responseTime !== undefined && (
                <span className="text-gray-500 text-xs">
                  {component.responseTime}ms
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-gray-900/50">
        <span className="text-gray-500 text-sm">
          {timeSinceCheck !== null ? `Last check: ${timeSinceCheck}s ago` : 'Checking...'}
        </span>
        <button
          onClick={handleReconcile}
          disabled={reconciling}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {reconciling ? 'Reconciling...' : 'Reconcile Now'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/SystemHealth.tsx
git commit -m "feat(web): add SystemHealth component"
```

---

## Task 7: Add SystemHealth to Dashboard

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Step 1: Import and add SystemHealth component**

Add import at top:
```typescript
import { SystemHealth } from '@/components/SystemHealth';
```

Add component in the dashboard layout (after the P&L section, before Recent Activity):
```typescript
{/* System Health */}
<div>
  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
    <span>🏥</span> System Health
  </h2>
  <SystemHealth />
</div>
```

**Step 2: Verify build passes**

Run: `cd apps/web && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): add SystemHealth to dashboard"
```

---

## Task 8: Test End-to-End

**Step 1: Restart API**

Run: `pm2 restart tradeguard-api`

**Step 2: Verify health endpoint works**

Run: `curl http://localhost:3667/health`
Expected: `{"status":"healthy"}` or similar

**Step 3: Verify detailed health (with auth)**

Login and call `/health/detailed`, verify all components show status.

**Step 4: Test reconciliation**

Run dry-run first: `POST /health/reconcile?dryRun=true`
Then actual if needed: `POST /health/reconcile`

**Step 5: Verify dashboard shows health widget**

Open browser, navigate to dashboard, confirm SystemHealth component renders.

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete health & reliability system implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | HealthLog Entity | `health/entities/health-log.entity.ts` |
| 2 | Health Module Structure | `health/*.ts` (4 files) |
| 3 | Register in AppModule | `app.module.ts` |
| 4 | Database Migration | `migrations/` |
| 5 | API Client Methods | `web/lib/api.ts` |
| 6 | SystemHealth Component | `web/components/SystemHealth.tsx` |
| 7 | Add to Dashboard | `web/dashboard/page.tsx` |
| 8 | End-to-End Testing | Manual verification |

**Parallel Task Groups:**
- Tasks 1-4 (Backend) can run in parallel with Tasks 5-7 (Frontend)
- Task 8 depends on all others completing
