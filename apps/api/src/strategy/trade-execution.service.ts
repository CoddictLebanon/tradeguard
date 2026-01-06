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
import { PolygonService } from '../data/polygon.service';

export interface TradeExecutionResult {
  success: boolean;
  error?: string;
  positionId?: string;
  shares?: number;
  entryPrice?: number;
}

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
    private readonly polygonService: PolygonService,
  ) {}

  @OnEvent('opportunity.approved')
  async handleOpportunityApproved(opportunity: Opportunity): Promise<void> {
    // Event handler for backward compatibility - just delegates to executeOpportunityTrade
    await this.executeOpportunityTrade(opportunity);
  }

  async executeOpportunityTrade(opportunity: Opportunity): Promise<TradeExecutionResult> {
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
        return { success: false, error: `Trade blocked: ${canTrade.reason}` };
      }

      // Fetch LIVE price - don't use stale opportunity data
      let entryPrice: number;
      try {
        const quote = await this.polygonService.getQuote(opportunity.symbol);
        entryPrice = quote.price;
        this.logger.log(`${opportunity.symbol}: Using live price $${entryPrice.toFixed(2)} (opportunity had $${opportunity.suggestedEntry})`);
      } catch (err) {
        // Fall back to opportunity price if quote fails
        entryPrice = Number(opportunity.suggestedEntry) || Number(opportunity.currentPrice);
        this.logger.warn(`${opportunity.symbol}: Could not fetch live price, using opportunity price $${entryPrice.toFixed(2)}`);
      }
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
        return { success: false, error: `Position sizing rejected: ${positionCalc.reason}` };
      }

      const shares = positionCalc.shares!;
      const stopPrice = positionCalc.stop!;
      // Use the actual stop distance as trail percent (not a hardcoded value)
      const trailPercent = (positionCalc.stop_pct || 0) * 100;

      if (shares < 1) {
        this.logger.warn(`Cannot trade ${opportunity.symbol}: position too small (${shares} shares)`);
        return { success: false, error: 'Position too small (less than 1 share)' };
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
        const errorMsg = (orderError as Error).message;
        this.logger.error(`Failed to place IB buy order: ${errorMsg}`);
        return { success: false, error: `IB order failed: ${errorMsg}` };
      }

      // CRITICAL: Verify the position exists in IB before writing to database
      // Poll for position with retries to handle IB processing delay
      const MAX_RETRIES = 6;
      const RETRY_DELAY_MS = 2000;
      let ibPositionVerified = false;
      let actualShares = shares;
      let actualAvgCost = entryPrice;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

        try {
          const ibPositions = await this.ibService.getPositionsFromProxy();
          const ibPosition = ibPositions.find(p => p.symbol === opportunity.symbol);

          if (ibPosition && ibPosition.position > 0) {
            ibPositionVerified = true;
            actualShares = Math.round(ibPosition.position);
            actualAvgCost = ibPosition.avgCost;
            this.logger.log(`IB VERIFIED (attempt ${attempt}): ${opportunity.symbol} - ${actualShares} shares @ $${actualAvgCost.toFixed(2)}`);
            break;
          } else {
            this.logger.debug(`IB position not found for ${opportunity.symbol} (attempt ${attempt}/${MAX_RETRIES})`);
          }
        } catch (verifyErr) {
          this.logger.warn(`Failed to verify IB position (attempt ${attempt}): ${(verifyErr as Error).message}`);
        }
      }

      if (!ibPositionVerified) {
        // Position not confirmed in IB after all retries - do NOT write to database
        this.logger.error(`IB position verification failed for ${opportunity.symbol} after ${MAX_RETRIES} attempts`);
        return {
          success: false,
          error: `Order placed (ID: ${ibOrderId}) but position not confirmed in IB after ${MAX_RETRIES * RETRY_DELAY_MS / 1000}s. Check IB Gateway manually.`,
        };
      }

      // Place trailing stop order via IB
      try {
        ibStopOrderId = await this.ibService.placeTrailingStopOrder(
          opportunity.symbol,
          actualShares,
          trailPercent,
        );
        this.logger.log(`Trailing stop order placed: ${ibStopOrderId}`);
      } catch (stopError) {
        this.logger.error(`Failed to place IB stop order: ${(stopError as Error).message}`);
        ibStopOrderId = 0; // Mark as no stop order but continue - position is real
      }

      // IB CONFIRMED - Now safe to create the position in database
      const position = this.positionRepo.create({
        symbol: opportunity.symbol,
        entryPrice: actualAvgCost, // Use IB's actual fill price
        shares: actualShares,
        stopPrice,
        trailPercent,
        currentPrice: actualAvgCost,
        highestPrice: actualAvgCost,
        status: PositionStatus.OPEN, // Directly OPEN since IB confirmed
        ibOrderId: ibOrderId.toString(),
        ibStopOrderId: ibStopOrderId ? ibStopOrderId.toString() : undefined,
        openedAt: new Date(),
      });

      await this.positionRepo.save(position);

      // Log the activity with IB's actual fill price
      await this.activityRepo.save({
        type: ActivityType.POSITION_OPENED,
        positionId: position.id,
        symbol: opportunity.symbol,
        message: `Opened ${tradingMode} position: ${actualShares} shares of ${opportunity.symbol} at $${actualAvgCost.toFixed(2)}`,
        details: {
          shares: actualShares,
          entryPrice: actualAvgCost, // IB's actual fill price
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
        details: { entryPrice: actualAvgCost, stopPrice, shares: actualShares },
      });

      this.logger.log(
        `[${tradingMode.toUpperCase()}] Position opened: ${actualShares} ${opportunity.symbol} @ $${actualAvgCost.toFixed(2)} ` +
        `(Stop: $${stopPrice.toFixed(2)}, Trail: ${trailPercent}%) [Orders: ${ibOrderId}, ${ibStopOrderId}]`
      );

      return {
        success: true,
        positionId: position.id,
        shares: actualShares,
        entryPrice: actualAvgCost, // Return IB's actual fill price
      };

    } catch (error) {
      const errorMsg = (error as Error).message;
      this.logger.error(`Failed to execute trade for ${opportunity.symbol}: ${errorMsg}`);
      await this.activityRepo.save({
        type: ActivityType.SYSTEM,
        message: `Trade execution failed for ${opportunity.symbol}`,
        symbol: opportunity.symbol,
        details: { error: errorMsg },
      });
      return { success: false, error: `Trade execution failed: ${errorMsg}` };
    }
  }
}
