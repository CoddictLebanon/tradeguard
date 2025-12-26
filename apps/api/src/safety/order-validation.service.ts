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

    // 2. Validate position size
    const positionValue = request.quantity * request.price;
    const positionCheck = await this.circuitBreaker.validatePositionSize(
      positionValue,
      request.portfolioValue,
    );
    if (!positionCheck.valid) {
      errors.push(positionCheck.reason || 'Position size exceeds limit');
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
      } else if (existingPosition.quantity < request.quantity) {
        errors.push(
          `Trying to sell ${request.quantity} shares but only have ${existingPosition.quantity}`,
        );
      }
    }

    // 5. Validate minimum order value ($100 minimum)
    if (positionValue < 100) {
      errors.push(`Order value $${positionValue.toFixed(2)} below minimum $100`);
    }

    // 6. Calculate maximum allowed quantity based on position limits
    const limits = this.circuitBreaker.getLimits();
    const maxPositionValue = (limits.maxPositionSize / 100) * request.portfolioValue;
    const maxQuantity = Math.floor(maxPositionValue / request.price);

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
    const maxPositionValue = (limits.maxPositionSize / 100) * portfolioValue;
    return Math.floor(maxPositionValue / price);
  }

  async getValidationSummary(portfolioValue: number): Promise<{
    canTrade: boolean;
    tradingMode: 'paper' | 'live';
    isPaused: boolean;
    pauseReason: string | null;
    limits: {
      maxPositionValue: number;
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
        maxPositionValue: (limits.maxPositionSize / 100) * portfolioValue,
        maxOpenPositions: limits.maxOpenPositions,
        currentOpenPositions: state.openPositionsCount,
      },
    };
  }
}
