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
    const componentMap: Record<string, HealthComponent> = {
      ibGateway: HealthComponent.IB_GATEWAY,
      ibProxy: HealthComponent.IB_PROXY,
      database: HealthComponent.DATABASE,
      positionSync: HealthComponent.POSITION_SYNC,
      cronJobs: HealthComponent.CRON_JOBS,
    };

    for (const [name, health] of Object.entries(components)) {
      await this.logHealth(componentMap[name], health);
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
      // Use quoted identifiers for camelCase column names (TypeORM default)
      const recentLogs = await this.healthLogRepo.query(
        `SELECT * FROM cron_logs WHERE "jobName" = 'trailing_stop_reassessment' AND "startedAt" > $1 ORDER BY "startedAt" DESC LIMIT 1`,
        [thirtyFiveMinutesAgo]
      );

      if (recentLogs.length > 0) {
        return {
          status: HealthStatus.HEALTHY,
          message: 'Running',
          details: { lastRun: recentLogs[0].startedAt },
        };
      }

      // Check if multiple runs missed
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const olderLogs = await this.healthLogRepo.query(
        `SELECT * FROM cron_logs WHERE "jobName" = 'trailing_stop_reassessment' AND "startedAt" > $1 ORDER BY "startedAt" DESC LIMIT 1`,
        [twoHoursAgo]
      );

      if (olderLogs.length === 0) {
        return { status: HealthStatus.CRITICAL, message: 'Multiple runs missed' };
      }

      return {
        status: HealthStatus.DEGRADED,
        message: 'Missed last run',
        details: { lastRun: olderLogs[0]?.startedAt },
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

    let emoji = '[OK]';
    let message = 'System healthy';

    if (newStatus === HealthStatus.CRITICAL) {
      emoji = '[CRITICAL]';
      const critical = Object.entries(components)
        .filter(([, h]) => h.status === HealthStatus.CRITICAL)
        .map(([name, h]) => `${name}: ${h.message}`)
        .join(', ');
      message = `CRITICAL: ${critical}`;
    } else if (newStatus === HealthStatus.DEGRADED) {
      emoji = '[WARNING]';
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
