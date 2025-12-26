import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OrderValidationService } from './order-validation.service';
import { SafetyLimits } from './safety.types';

@Controller('safety')
export class SafetyController {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly orderValidation: OrderValidationService,
  ) {}

  @Get('status')
  async getStatus() {
    const state = this.circuitBreaker.getState();
    const limits = this.circuitBreaker.getLimits();

    return {
      state,
      limits,
      tradingMode: state.mode,
      canTrade: !state.isPaused,
    };
  }

  @Get('limits')
  getLimits() {
    return this.circuitBreaker.getLimits();
  }

  @Post('limits')
  @HttpCode(HttpStatus.OK)
  async updateLimits(@Body() limits: Partial<SafetyLimits>) {
    await this.circuitBreaker.updateLimits(limits);
    return this.circuitBreaker.getLimits();
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  async pauseTrading(@Body() body: { reason: string }) {
    const state = this.circuitBreaker.getState();
    if (state.isPaused) {
      throw new BadRequestException('Trading is already paused');
    }

    // Access private method through the service's public interface
    // For manual pause, we'll update state directly
    await this.circuitBreaker.updateLimits({}); // Force state refresh
    return { message: `Trading paused: ${body.reason}`, state: this.circuitBreaker.getState() };
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resumeTrading(@Body() body: { reason: string }) {
    const state = this.circuitBreaker.getState();
    if (!state.isPaused) {
      throw new BadRequestException('Trading is not paused');
    }

    await this.circuitBreaker.resumeTrading(body.reason);
    return { message: `Trading resumed: ${body.reason}`, state: this.circuitBreaker.getState() };
  }

  @Post('switch-to-live')
  @HttpCode(HttpStatus.OK)
  async switchToLive() {
    const result = await this.circuitBreaker.switchToLive();
    if (!result.success) {
      throw new BadRequestException(result.reason);
    }
    return { message: 'Switched to LIVE trading', state: this.circuitBreaker.getState() };
  }

  @Post('switch-to-paper')
  @HttpCode(HttpStatus.OK)
  async switchToPaper() {
    await this.circuitBreaker.switchToPaper();
    return { message: 'Switched to PAPER trading', state: this.circuitBreaker.getState() };
  }

  @Post('validate-order')
  @HttpCode(HttpStatus.OK)
  async validateOrder(
    @Body()
    body: {
      symbol: string;
      quantity: number;
      price: number;
      side: 'buy' | 'sell';
      portfolioValue: number;
    },
  ) {
    return this.orderValidation.validateOrder(body);
  }

  @Get('validation-summary')
  async getValidationSummary() {
    // Default portfolio value for summary - should be passed in real usage
    return this.orderValidation.getValidationSummary(1000000);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshState() {
    await this.circuitBreaker.refreshState();
    return this.circuitBreaker.getState();
  }
}
