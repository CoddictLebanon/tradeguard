import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CircuitBreakerService } from './circuit-breaker.service';
import { Position, PositionStatus } from '../entities/position.entity';
import { Setting } from '../entities/settings.entity';

export interface OrderValidationRequest {
  symbol: string;
  quantity: number;
  price: number;
  side: 'buy' | 'sell';
  portfolioValue: number;
}

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  adjustedQuantity?: number;
}

@Injectable()
export class OrderValidationService {
  private readonly logger = new Logger(OrderValidationService.name);

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  async validateOrder(request: OrderValidationRequest): Promise<OrderValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Check circuit breaker status
    const canTrade = await this.circuitBreaker.canTrade(request.portfolioValue);
    if (!canTrade.allowed) {
      errors.push(canTrade.reason || 'Trading is currently paused');
      return { valid: false, errors, warnings };
    }

    // 2. Validate position size against capital deployment limit
    const positionValue = request.quantity * request.price;
    const limits = this.circuitBreaker.getLimits();
    const state = this.circuitBreaker.getState();
    const maxCapitalAllowed = (limits.maxCapitalDeployedPercent / 100) * request.portfolioValue;
    if (state.capitalDeployed + positionValue > maxCapitalAllowed) {
      errors.push(`Position would exceed max capital deployment (${limits.maxCapitalDeployedPercent}%)`);
    }

    // 3. Check for duplicate positions on buy
    if (request.side === 'buy') {
      const existingPosition = await this.positionRepo.findOne({
        where: {
          symbol: request.symbol,
          status: PositionStatus.OPEN,
        },
      });

      if (existingPosition) {
        warnings.push(`Already have an open position in ${request.symbol}`);
      }
    }

    // 4. Check for sell without position
    if (request.side === 'sell') {
      const existingPosition = await this.positionRepo.findOne({
        where: {
          symbol: request.symbol,
          status: PositionStatus.OPEN,
        },
      });

      if (!existingPosition) {
        errors.push(`No open position in ${request.symbol} to sell`);
      } else if (existingPosition.shares < request.quantity) {
        errors.push(
          `Trying to sell ${request.quantity} shares but only have ${existingPosition.shares}`,
        );
      }
    }

    // 5. Validate minimum order value ($100 minimum)
    if (positionValue < 100) {
      errors.push(`Order value $${positionValue.toFixed(2)} below minimum $100`);
    }

    // 6. Calculate maximum allowed quantity based on capital deployment limits
    const maxCapitalForNewPosition = maxCapitalAllowed - state.capitalDeployed;
    const maxQuantity = Math.floor(Math.max(0, maxCapitalForNewPosition) / request.price);

    let adjustedQuantity: number | undefined;
    if (request.quantity > maxQuantity && request.side === 'buy') {
      adjustedQuantity = maxQuantity;
      warnings.push(
        `Quantity reduced from ${request.quantity} to ${maxQuantity} to meet position size limit`,
      );
    }

    // 7. Paper trading mode warning
    if (this.circuitBreaker.isPaperMode()) {
      warnings.push('Order will be executed in PAPER TRADING mode');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      adjustedQuantity,
    };
  }

  async validateBuyOrder(
    symbol: string,
    quantity: number,
    price: number,
    portfolioValue: number,
  ): Promise<OrderValidationResult> {
    return this.validateOrder({
      symbol,
      quantity,
      price,
      side: 'buy',
      portfolioValue,
    });
  }

  async validateSellOrder(
    symbol: string,
    quantity: number,
    price: number,
    portfolioValue: number,
  ): Promise<OrderValidationResult> {
    return this.validateOrder({
      symbol,
      quantity,
      price,
      side: 'sell',
      portfolioValue,
    });
  }

  async calculateMaxQuantity(
    symbol: string,
    price: number,
    portfolioValue: number,
  ): Promise<number> {
    const limits = this.circuitBreaker.getLimits();
    const state = this.circuitBreaker.getState();
    const maxCapitalAllowed = (limits.maxCapitalDeployedPercent / 100) * portfolioValue;
    const maxCapitalForNewPosition = maxCapitalAllowed - state.capitalDeployed;
    return Math.floor(Math.max(0, maxCapitalForNewPosition) / price);
  }

  async getValidationSummary(portfolioValue: number): Promise<{
    canTrade: boolean;
    tradingMode: 'paper' | 'live';
    isPaused: boolean;
    pauseReason: string | null;
    limits: {
      maxCapitalDeployedValue: number;
      currentCapitalDeployed: number;
      maxOpenPositions: number;
      currentOpenPositions: number;
    };
  }> {
    const canTrade = await this.circuitBreaker.canTrade(portfolioValue);
    const state = this.circuitBreaker.getState();
    const limits = this.circuitBreaker.getLimits();

    return {
      canTrade: canTrade.allowed,
      tradingMode: state.mode,
      isPaused: state.isPaused,
      pauseReason: state.pauseReason,
      limits: {
        maxCapitalDeployedValue: (limits.maxCapitalDeployedPercent / 100) * portfolioValue,
        currentCapitalDeployed: state.capitalDeployed,
        maxOpenPositions: limits.maxOpenPositions,
        currentOpenPositions: state.openPositionsCount,
      },
    };
  }
}
