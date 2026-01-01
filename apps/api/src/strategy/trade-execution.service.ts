import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { Opportunity } from '../entities/opportunity.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { CircuitBreakerService } from '../safety/circuit-breaker.service';
import { IBService } from '../ib/ib.service';
import { PositionSizingService } from '../risk/position-sizing.service';

@Injectable()
export class TradeExecutionService {
  private readonly logger = new Logger(TradeExecutionService.name);

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly ibService: IBService,
    private readonly positionSizing: PositionSizingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('opportunity.approved')
  async handleOpportunityApproved(opportunity: Opportunity): Promise<void> {
    this.logger.log(`Processing approved opportunity: ${opportunity.symbol}`);

    try {
      // Get position sizing from settings
      const accountConfig = this.positionSizing.getAccountConfig();

      // Check if trading is allowed
      const canTrade = await this.circuitBreaker.canTrade(accountConfig.totalCapital);
      if (!canTrade.allowed) {
        this.logger.warn(`Trade blocked for ${opportunity.symbol}: ${canTrade.reason}`);
        await this.activityRepo.save({
          type: ActivityType.TRADE_BLOCKED,
          message: `Trade blocked for ${opportunity.symbol}: ${canTrade.reason}`,
          symbol: opportunity.symbol,
          details: { reason: canTrade.reason, opportunity },
        });
        return;
      }

      // Calculate position size using the position sizing service
      const entryPrice = Number(opportunity.suggestedEntry) || Number(opportunity.currentPrice);
      const pullbackLow = Number(opportunity.factors?.pullbackLow) || entryPrice * 0.95;

      const positionCalc = this.positionSizing.calculateSwingPosition({
        symbol: opportunity.symbol,
        entry: entryPrice,
        pullbackLow,
      });

      if (positionCalc.status === 'REJECT') {
        this.logger.warn(`Position sizing rejected for ${opportunity.symbol}: ${positionCalc.reason}`);
        await this.activityRepo.save({
          type: ActivityType.TRADE_BLOCKED,
          message: `Position sizing rejected for ${opportunity.symbol}: ${positionCalc.reason}`,
          symbol: opportunity.symbol,
          details: { reason: positionCalc.reason, positionCalc },
        });
        return;
      }

      const shares = positionCalc.shares!;
      const stopPrice = positionCalc.stop!;
      // Use the actual stop distance as trail percent (not a hardcoded value)
      const trailPercent = (positionCalc.stop_pct || 0) * 100;

      if (shares < 1) {
        this.logger.warn(`Cannot trade ${opportunity.symbol}: position too small (${shares} shares)`);
        return;
      }

      // Place buy order via IB (works for both paper and live mode)
      const tradingMode = this.circuitBreaker.getTradingMode();
      this.logger.log(`Placing ${tradingMode.toUpperCase()} order for ${shares} shares of ${opportunity.symbol}`);

      // Place market buy order via IB - MUST succeed before creating position
      let ibOrderId: number;
      let ibStopOrderId: number;

      try {
        ibOrderId = await this.ibService.placeBuyOrder(opportunity.symbol, shares);
        this.logger.log(`Buy order placed: ${ibOrderId}`);
      } catch (orderError) {
        this.logger.error(`Failed to place IB buy order: ${(orderError as Error).message}`);
        await this.activityRepo.save({
          type: ActivityType.TRADE_BLOCKED,
          message: `Failed to place IB buy order for ${opportunity.symbol}: ${(orderError as Error).message}`,
          symbol: opportunity.symbol,
          details: { error: (orderError as Error).message, shares, entryPrice },
        });
        return; // Do NOT create position if IB buy order fails
      }

      // Place trailing stop order via IB - MUST succeed
      try {
        ibStopOrderId = await this.ibService.placeTrailingStopOrder(
          opportunity.symbol,
          shares,
          trailPercent,
        );
        this.logger.log(`Trailing stop order placed: ${ibStopOrderId}`);
      } catch (stopError) {
        this.logger.error(`Failed to place IB stop order: ${(stopError as Error).message}`);
        // Stop order failed but buy order succeeded - log warning but continue
        // The position will be created without a stop order ID
        await this.activityRepo.save({
          type: ActivityType.SYSTEM,
          message: `Warning: Buy order succeeded but stop order failed for ${opportunity.symbol}`,
          symbol: opportunity.symbol,
          details: { error: (stopError as Error).message, ibOrderId },
        });
        ibStopOrderId = 0; // Mark as no stop order
      }

      // Create the position - only reaches here if IB buy order succeeded
      const position = this.positionRepo.create({
        symbol: opportunity.symbol,
        entryPrice,
        shares,
        stopPrice,
        trailPercent,
        currentPrice: entryPrice,
        highestPrice: entryPrice,
        status: PositionStatus.OPEN,
        openedAt: new Date(),
        ibOrderId: ibOrderId.toString(),
        ibStopOrderId: ibStopOrderId ? ibStopOrderId.toString() : undefined,
      });

      await this.positionRepo.save(position);

      // Log the activity
      await this.activityRepo.save({
        type: ActivityType.POSITION_OPENED,
        positionId: position.id,
        symbol: opportunity.symbol,
        message: `Opened ${tradingMode} position: ${shares} shares of ${opportunity.symbol} at $${entryPrice.toFixed(2)}`,
        details: {
          shares,
          entryPrice,
          stopPrice,
          trailPercent,
          opportunityScore: opportunity.score,
          mode: tradingMode,
          ibOrderId,
          ibStopOrderId,
        },
      });

      // Emit event for Telegram notifications
      this.eventEmitter.emit('activity.trade', {
        type: ActivityType.POSITION_OPENED,
        symbol: opportunity.symbol,
        details: { entryPrice, stopPrice, shares },
      });

      this.logger.log(
        `[${tradingMode.toUpperCase()}] Position opened: ${shares} ${opportunity.symbol} @ $${entryPrice.toFixed(2)} ` +
        `(Stop: $${stopPrice.toFixed(2)}, Trail: ${trailPercent}%) [Orders: ${ibOrderId}, ${ibStopOrderId}]`
      );

    } catch (error) {
      this.logger.error(`Failed to execute trade for ${opportunity.symbol}: ${(error as Error).message}`);
      await this.activityRepo.save({
        type: ActivityType.SYSTEM,
        message: `Trade execution failed for ${opportunity.symbol}`,
        symbol: opportunity.symbol,
        details: { error: (error as Error).message },
      });
    }
  }
}
