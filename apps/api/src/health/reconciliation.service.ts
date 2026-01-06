import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
    @Inject(forwardRef(() => HealthService))
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
        await this.telegramService.sendMessage(`[RECONCILED] ${messages.join(' | ')}`);
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
