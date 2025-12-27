// apps/api/src/strategy/trade-qualification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { TradeUniverseService } from '../universe/trade-universe.service';
import { EarningsCalendarService } from '../events/earnings-calendar.service';
import { PositionSizingService } from '../risk/position-sizing.service';
import { CircuitBreakerService } from '../safety/circuit-breaker.service';
import { TradeSetupService } from './trade-setup.service';
import {
  TradeQualification,
  TradeRejectionReason,
} from './conservative-trading.types';

@Injectable()
export class TradeQualificationService {
  private readonly logger = new Logger(TradeQualificationService.name);

  constructor(
    private readonly polygonService: PolygonService,
    private readonly universeService: TradeUniverseService,
    private readonly earningsService: EarningsCalendarService,
    private readonly positionSizingService: PositionSizingService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly tradeSetupService: TradeSetupService,
  ) {}

  async qualifyTrade(symbol: string): Promise<TradeQualification> {
    const upperSymbol = symbol.toUpperCase();
    this.logger.log(`Qualifying trade for ${upperSymbol}`);

    // Step 1: Check if circuit breaker allows new trades
    const portfolioValue = this.positionSizingService.getAccountConfig().totalCapital;
    const canTrade = await this.circuitBreakerService.canTrade(portfolioValue);
    if (!canTrade.allowed) {
      return this.reject(upperSymbol, this.mapCircuitBreakerReason(canTrade.reason));
    }

    // Step 2: Check if symbol is in valid universe
    const universeCheck = await this.universeService.checkSymbol(upperSymbol);
    if (!universeCheck.inUniverse) {
      return this.reject(upperSymbol, TradeRejectionReason.NOT_IN_UNIVERSE);
    }

    // Step 3: Check for upcoming earnings
    const earningsCheck = await this.earningsService.hasEarningsWithinDays(upperSymbol, 5);
    if (earningsCheck.hasEarnings) {
      this.logger.log(`${upperSymbol} has earnings in ${earningsCheck.daysUntil} days - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.EARNINGS_SOON);
    }

    // Step 4: Get extended technical indicators
    let indicators;
    try {
      indicators = await this.polygonService.getExtendedIndicators(upperSymbol);
    } catch (error) {
      this.logger.error(`Failed to get indicators for ${upperSymbol}: ${(error as Error).message}`);
      return this.reject(upperSymbol, TradeRejectionReason.NOT_IN_UNIVERSE);
    }

    // Step 5: Check trend filter (MANDATORY)
    // Price must be above 200-day MA AND 200-day MA must be flat or rising
    if (indicators.priceVsSma200Percent < 0) {
      this.logger.log(`${upperSymbol} is below 200-day MA (${indicators.priceVsSma200Percent.toFixed(2)}%) - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.BELOW_200_MA);
    }

    if (indicators.sma200Slope < -0.5) { // Allow slightly negative slope
      this.logger.log(`${upperSymbol} 200-day MA is declining (${indicators.sma200Slope.toFixed(2)}%) - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.MA_200_DECLINING);
    }

    // Step 6: Check for valid trade setup
    const quote = await this.polygonService.getQuote(upperSymbol);
    const currentPrice = quote.price;

    const setup = await this.tradeSetupService.detectSetup(upperSymbol, indicators, currentPrice);
    if (!setup.hasSetup) {
      return this.reject(upperSymbol, TradeRejectionReason.NO_VALID_SETUP);
    }

    // Step 7: Calculate position size
    const state = this.circuitBreakerService.getState();
    const positionSize = this.positionSizingService.calculatePositionSize(
      setup.suggestedEntry,
      setup.suggestedStop,
      state.capitalDeployed,
    );

    if (!positionSize.valid) {
      if (positionSize.stopDistancePercent < 2) {
        return this.reject(upperSymbol, TradeRejectionReason.STOP_TOO_TIGHT);
      }
      if (positionSize.stopDistancePercent > 6) {
        return this.reject(upperSymbol, TradeRejectionReason.STOP_TOO_WIDE);
      }
      return this.reject(upperSymbol, TradeRejectionReason.MAX_CAPITAL_DEPLOYED);
    }

    // All checks passed - trade is qualified
    this.logger.log(`${upperSymbol} QUALIFIED: ${setup.setupType}, entry $${setup.suggestedEntry}, stop $${setup.suggestedStop}`);

    return {
      symbol: upperSymbol,
      qualified: true,
      setupType: setup.setupType,
      entryPrice: setup.suggestedEntry,
      stopPrice: setup.suggestedStop,
      stopDistancePercent: positionSize.stopDistancePercent,
      positionSizeDollars: positionSize.positionSizeDollars,
      shares: positionSize.shares,
      maxDollarRisk: positionSize.maxDollarRisk,
      estimatedUpsidePercent: setup.estimatedUpsidePercent,
    };
  }

  private reject(symbol: string, reason: TradeRejectionReason): TradeQualification {
    this.logger.log(`${symbol} REJECTED: ${reason}`);
    return {
      symbol,
      qualified: false,
      rejectionReason: reason,
    };
  }

  private mapCircuitBreakerReason(reason?: string): TradeRejectionReason {
    if (!reason) return TradeRejectionReason.DAILY_LIMIT_HIT;
    if (reason.includes('daily')) return TradeRejectionReason.DAILY_LIMIT_HIT;
    if (reason.includes('weekly')) return TradeRejectionReason.WEEKLY_LIMIT_HIT;
    if (reason.includes('monthly')) return TradeRejectionReason.MONTHLY_LIMIT_HIT;
    if (reason.includes('positions')) return TradeRejectionReason.MAX_POSITIONS;
    if (reason.includes('capital')) return TradeRejectionReason.MAX_CAPITAL_DEPLOYED;
    return TradeRejectionReason.DAILY_LIMIT_HIT;
  }

  async qualifyMultiple(symbols: string[]): Promise<TradeQualification[]> {
    const results: TradeQualification[] = [];

    for (const symbol of symbols) {
      try {
        const qualification = await this.qualifyTrade(symbol);
        results.push(qualification);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        this.logger.error(`Error qualifying ${symbol}: ${(error as Error).message}`);
        results.push(this.reject(symbol, TradeRejectionReason.NOT_IN_UNIVERSE));
      }
    }

    // Sort: qualified first, then by estimated upside
    return results.sort((a, b) => {
      if (a.qualified && !b.qualified) return -1;
      if (!a.qualified && b.qualified) return 1;
      return (b.estimatedUpsidePercent || 0) - (a.estimatedUpsidePercent || 0);
    });
  }
}
