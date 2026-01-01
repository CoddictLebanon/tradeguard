import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Position, PositionStatus } from '../entities/position.entity';
import { PolygonService } from '../data/polygon.service';
import { StockBar } from '../data/data.types';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { IBService } from '../ib/ib.service';
import {
  TrailingStopConfig,
  DEFAULT_TRAILING_STOP_CONFIG,
  DEFAULT_SIMULATION_CONFIG,
} from '../safety/safety.types';

export interface StructuralAnalysis {
  currentHigh: number;
  currentHighDate: Date;
  pullbackLow: number;
  pullbackLowDate: Date;
  isNewHigherLow: boolean;
  bounceConfirmed: boolean;
  newStopPrice: number | null;
  shouldUpdateStop: boolean;
  reason: string;
}

export interface TrailingStopUpdate {
  positionId: string;
  symbol: string;
  previousStop: number;
  newStop: number;
  structuralHigh: number;
  structuralLow: number;
  reason: string;
}

@Injectable()
export class TrailingStopService {
  private readonly logger = new Logger(TrailingStopService.name);
  private config: TrailingStopConfig = DEFAULT_TRAILING_STOP_CONFIG;

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly polygonService: PolygonService,
    private readonly ibService: IBService,
  ) {}

  /**
   * Analyze price structure to find valid higher lows for trailing stop
   *
   * Logic:
   * 1. Find the highest close since the structural high date (or entry)
   * 2. After a new high, find the lowest low in the pullback
   * 3. Check if current close confirms a bounce (close >= low * 1.02)
   * 4. If confirmed and new low > previous structural low, we have a valid higher low
   */
  analyzeStructure(
    bars: StockBar[],
    currentStructuralHigh: number,
    currentStructuralLow: number,
    currentStop: number,
  ): StructuralAnalysis {
    if (bars.length < 2) {
      return {
        currentHigh: currentStructuralHigh,
        currentHighDate: new Date(),
        pullbackLow: currentStructuralLow,
        pullbackLowDate: new Date(),
        isNewHigherLow: false,
        bounceConfirmed: false,
        newStopPrice: null,
        shouldUpdateStop: false,
        reason: 'Insufficient data for analysis',
      };
    }

    const currentBar = bars[bars.length - 1];
    const currentClose = currentBar.close;

    // Find the highest close in the lookback period
    let highestClose = currentStructuralHigh;
    let highestCloseDate = bars[0].timestamp;
    let highestCloseIndex = 0;

    for (let i = 0; i < bars.length; i++) {
      if (bars[i].close >= highestClose) {
        highestClose = bars[i].close;
        highestCloseDate = bars[i].timestamp;
        highestCloseIndex = i;
      }
    }

    // Find the lowest low from the high to now (pullback low)
    const barsFromHighToNow = bars.slice(highestCloseIndex);
    let pullbackLow = Infinity;
    let pullbackLowDate = bars[bars.length - 1].timestamp;

    for (const bar of barsFromHighToNow) {
      if (bar.low < pullbackLow) {
        pullbackLow = bar.low;
        pullbackLowDate = bar.timestamp;
      }
    }

    // Check if this is a new higher low (higher than previous structural low)
    const isNewHigherLow = pullbackLow > currentStructuralLow;

    // Check bounce confirmation: close >= pullbackLow * (1 + bouncePercent)
    const bounceThreshold = pullbackLow * (1 + this.config.bounceConfirmationPercent);
    const bounceConfirmed = currentClose >= bounceThreshold;

    // Calculate potential new stop
    const potentialNewStop = pullbackLow * (1 - this.config.stopBuffer);

    // Determine if we should update
    const shouldUpdateStop = isNewHigherLow && bounceConfirmed && potentialNewStop > currentStop;

    let reason: string;
    if (shouldUpdateStop) {
      reason = `New higher low at $${pullbackLow.toFixed(2)} (was $${currentStructuralLow.toFixed(2)}), bounce confirmed at $${currentClose.toFixed(2)}`;
    } else if (!isNewHigherLow) {
      reason = `Pullback low $${pullbackLow.toFixed(2)} not higher than structural low $${currentStructuralLow.toFixed(2)}`;
    } else if (!bounceConfirmed) {
      reason = `Bounce not confirmed: close $${currentClose.toFixed(2)} < threshold $${bounceThreshold.toFixed(2)}`;
    } else {
      reason = `New stop $${potentialNewStop.toFixed(2)} not higher than current stop $${currentStop.toFixed(2)}`;
    }

    return {
      currentHigh: highestClose,
      currentHighDate: highestCloseDate,
      pullbackLow,
      pullbackLowDate,
      isNewHigherLow,
      bounceConfirmed,
      newStopPrice: shouldUpdateStop ? potentialNewStop : null,
      shouldUpdateStop,
      reason,
    };
  }

  /**
   * Re-assess a single position and update stop if valid higher structure found
   */
  async reassessPosition(position: Position): Promise<TrailingStopUpdate | null> {
    try {
      // Get bars from entry date to now
      const entryDate = position.openedAt || position.createdAt;
      const fromDate = new Date(entryDate);
      fromDate.setDate(fromDate.getDate() - 5); // Buffer for weekends
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = new Date().toISOString().split('T')[0];

      const bars = await this.polygonService.getBarsForDateRange(
        position.symbol,
        fromDateStr,
        toDateStr,
        'day',
      );

      if (bars.length < 2) {
        this.logger.warn(`Insufficient data for ${position.symbol}`);
        return null;
      }

      // Use existing structural values or initialize from entry
      const currentStructuralHigh = Number(position.structuralHigh) || Number(position.entryPrice);
      const currentStructuralLow = Number(position.structuralLow) ||
        (Number(position.stopPrice) / (1 - this.config.stopBuffer)); // Reverse-calculate initial low
      const currentStop = Number(position.stopPrice);

      const analysis = this.analyzeStructure(
        bars,
        currentStructuralHigh,
        currentStructuralLow,
        currentStop,
      );

      if (analysis.shouldUpdateStop && analysis.newStopPrice) {
        // FIRST: Update stop in IB Gateway if position has an IB stop order
        if (position.ibStopOrderId) {
          try {
            const ibResult = await this.ibService.modifyStopPrice(
              parseInt(position.ibStopOrderId, 10),
              position.symbol,
              position.shares,
              currentStop,
              analysis.newStopPrice,
            );

            if (!ibResult.success) {
              this.logger.warn(
                `${position.symbol}: IB stop modification failed: ${ibResult.reason}`,
              );
              // Don't update database if IB update failed
              return null;
            }

            this.logger.log(
              `${position.symbol}: IB stop updated successfully`,
            );
          } catch (ibError) {
            this.logger.error(
              `${position.symbol}: Failed to update IB stop: ${(ibError as Error).message}`,
            );
            // Don't update database if IB update failed
            return null;
          }
        }

        // THEN: Update position in database (only after IB success)
        await this.positionRepo.update(position.id, {
          stopPrice: analysis.newStopPrice,
          structuralHigh: analysis.currentHigh,
          structuralLow: analysis.pullbackLow,
          structuralHighDate: analysis.currentHighDate,
          highestPrice: Math.max(Number(position.highestPrice) || 0, analysis.currentHigh),
        });

        const update: TrailingStopUpdate = {
          positionId: position.id,
          symbol: position.symbol,
          previousStop: currentStop,
          newStop: analysis.newStopPrice,
          structuralHigh: analysis.currentHigh,
          structuralLow: analysis.pullbackLow,
          reason: analysis.reason,
        };

        // Log the update
        await this.activityRepo.save({
          type: ActivityType.TRAILING_STOP_UPDATED,
          positionId: position.id,
          symbol: position.symbol,
          message: `Stop raised for ${position.symbol}: $${currentStop.toFixed(2)} → $${analysis.newStopPrice.toFixed(2)}`,
          details: update,
        });

        this.logger.log(
          `${position.symbol}: Stop raised $${currentStop.toFixed(2)} → $${analysis.newStopPrice.toFixed(2)} (${analysis.reason})`,
        );

        return update;
      } else {
        this.logger.debug(`${position.symbol}: No stop update - ${analysis.reason}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to reassess ${position.symbol}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Re-assess all open positions
   */
  async reassessAllPositions(): Promise<TrailingStopUpdate[]> {
    const openPositions = await this.positionRepo.find({
      where: { status: PositionStatus.OPEN },
    });

    if (openPositions.length === 0) {
      this.logger.log('No open positions to reassess');
      return [];
    }

    this.logger.log(`Reassessing ${openPositions.length} open positions...`);

    const updates: TrailingStopUpdate[] = [];
    for (const position of openPositions) {
      const update = await this.reassessPosition(position);
      if (update) {
        updates.push(update);
      }
    }

    this.logger.log(`Trailing stop reassessment complete: ${updates.length} updates made`);
    return updates;
  }

  /**
   * Run structure-based trailing stop simulation for backtesting
   * Returns the stop price history and events for a simulated trade
   */
  simulateTrailingStop(
    bars: StockBar[],
    entryPrice: number,
    initialStopPrice: number,
    maxDays: number = DEFAULT_SIMULATION_CONFIG.maxDays,
  ): {
    exitPrice: number;
    exitDate: string;
    exitReason: 'stopped_out' | 'max_days' | 'data_ended';
    daysHeld: number;
    events: Array<{
      day: number;
      date: string;
      type: 'ENTRY' | 'STOP_RAISED' | 'EXIT';
      price: number;
      stopPrice: number;
      note?: string;
    }>;
    dailyData: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      stopPrice: number;
    }>;
  } {
    const events: Array<{
      day: number;
      date: string;
      type: 'ENTRY' | 'STOP_RAISED' | 'EXIT';
      price: number;
      stopPrice: number;
      note?: string;
    }> = [];

    const dailyData: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      stopPrice: number;
    }> = [];

    let currentStop = initialStopPrice;
    // Initialize structural tracking: initial structural low = what produced the initial stop
    let structuralLow = initialStopPrice / (1 - this.config.stopBuffer);
    let structuralHigh = entryPrice;
    let structuralHighIndex = 0;

    let exitPrice = 0;
    let exitDate = '';
    let exitReason: 'stopped_out' | 'max_days' | 'data_ended' = 'data_ended';
    let daysHeld = 0;

    // Entry event
    const entryDate = bars[0]?.timestamp.toISOString().split('T')[0] || '';
    events.push({
      day: 0,
      date: entryDate,
      type: 'ENTRY',
      price: entryPrice,
      stopPrice: currentStop,
      note: `Entered at $${entryPrice.toFixed(2)}, initial stop at $${currentStop.toFixed(2)}`,
    });

    // Process each day
    for (let i = 0; i < bars.length && daysHeld < maxDays; i++) {
      const bar = bars[i];
      const barDate = bar.timestamp.toISOString().split('T')[0];
      daysHeld++;

      // Check if stopped out (low touches stop)
      if (bar.low <= currentStop) {
        exitPrice = currentStop;
        exitDate = barDate;
        exitReason = 'stopped_out';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Stopped out at $${exitPrice.toFixed(2)}`,
        });

        dailyData.push({
          date: barDate,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          stopPrice: currentStop,
        });

        break;
      }

      // Update structural high if we have a new high
      if (bar.close > structuralHigh) {
        structuralHigh = bar.close;
        structuralHighIndex = i;
      }

      // Analyze for potential new higher low
      // Get bars from structural high to current
      const barsFromHigh = bars.slice(structuralHighIndex, i + 1);

      if (barsFromHigh.length >= 2) {
        // Find the lowest low in the pullback
        let pullbackLow = Infinity;
        for (const b of barsFromHigh) {
          if (b.low < pullbackLow) {
            pullbackLow = b.low;
          }
        }

        // Check if this is a valid new higher low
        const isNewHigherLow = pullbackLow > structuralLow;
        const bounceThreshold = pullbackLow * (1 + this.config.bounceConfirmationPercent);
        const bounceConfirmed = bar.close >= bounceThreshold;

        if (isNewHigherLow && bounceConfirmed) {
          const newStop = pullbackLow * (1 - this.config.stopBuffer);

          if (newStop > currentStop) {
            const oldStop = currentStop;
            currentStop = newStop;
            structuralLow = pullbackLow;

            events.push({
              day: daysHeld,
              date: barDate,
              type: 'STOP_RAISED',
              price: bar.close,
              stopPrice: currentStop,
              note: `New higher low $${pullbackLow.toFixed(2)}, stop raised $${oldStop.toFixed(2)} → $${currentStop.toFixed(2)}`,
            });
          }
        }
      }

      dailyData.push({
        date: barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        stopPrice: currentStop,
      });

      // If max days reached
      if (daysHeld >= maxDays) {
        exitPrice = bar.close;
        exitDate = barDate;
        exitReason = 'max_days';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Max holding period (${maxDays} days) reached, exited at $${exitPrice.toFixed(2)}`,
        });
      }
    }

    // If we ran out of data before exit
    if (!exitDate && dailyData.length > 0) {
      const lastBar = dailyData[dailyData.length - 1];
      exitPrice = lastBar.close;
      exitDate = lastBar.date;
      exitReason = 'data_ended';

      events.push({
        day: daysHeld,
        date: exitDate,
        type: 'EXIT',
        price: exitPrice,
        stopPrice: currentStop,
        note: `Data ended, final price $${exitPrice.toFixed(2)}`,
      });
    }

    return {
      exitPrice,
      exitDate,
      exitReason,
      daysHeld,
      events,
      dailyData,
    };
  }

  /**
   * Daily cron job to reassess all open positions
   * Runs at 5pm ET (after market close)
   */
  @Cron('0 17 * * 1-5', { timeZone: 'America/New_York' })
  async dailyReassessment(): Promise<void> {
    this.logger.log('Running daily trailing stop reassessment...');
    await this.reassessAllPositions();
  }

  /**
   * Get current config
   */
  getConfig(): TrailingStopConfig {
    return { ...this.config };
  }

  /**
   * Update config (validates buffer range)
   */
  updateConfig(config: Partial<TrailingStopConfig>): void {
    if (config.stopBuffer !== undefined) {
      if (config.stopBuffer < 0.005 || config.stopBuffer > 0.010) {
        throw new Error('stopBuffer must be between 0.005 and 0.010');
      }
    }
    this.config = { ...this.config, ...config };
    this.logger.log(`Trailing stop config updated: ${JSON.stringify(this.config)}`);
  }
}
