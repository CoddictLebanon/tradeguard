import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
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
      const account = await this.ibService.getAccountSummary();
      const positions = await this.ibService.getPositionsFromProxy();

      const totalValue = account?.netLiquidation || 0;
      const cash = account?.totalCashValue || 0;
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
        const account = await this.ibService.getAccountSummary();
        currentValue = account?.netLiquidation || 0;
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
