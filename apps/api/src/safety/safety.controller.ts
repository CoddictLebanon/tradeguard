import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OrderValidationService } from './order-validation.service';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';
import {
  UpdateLimitsDto,
  PauseResumeDto,
  UpdateSimulationConfigDto,
  ValidateOrderDto,
} from './dto/safety.dto';

@Controller('safety')
export class SafetyController {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly orderValidation: OrderValidationService,
  ) {}

  // Read-only endpoints - all authenticated users can view
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

  @Get('validation-summary')
  async getValidationSummary(@Query('portfolioValue') portfolioValue?: string) {
    const value = portfolioValue ? parseFloat(portfolioValue) : 1000000;
    return this.orderValidation.getValidationSummary(value);
  }

  // Modification endpoints - admin only
  @Post('limits')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async updateLimits(@Body() dto: UpdateLimitsDto) {
    await this.circuitBreaker.updateLimits(dto);
    return this.circuitBreaker.getLimits();
  }

  @Post('pause')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async pauseTrading(@Body() dto: PauseResumeDto) {
    const state = this.circuitBreaker.getState();
    if (state.isPaused) {
      throw new BadRequestException('Trading is already paused');
    }

    await this.circuitBreaker.manualPause(dto.reason);
    return { message: `Trading paused: ${dto.reason}`, state: this.circuitBreaker.getState() };
  }

  @Post('resume')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async resumeTrading(@Body() dto: PauseResumeDto) {
    const state = this.circuitBreaker.getState();
    if (!state.isPaused) {
      throw new BadRequestException('Trading is not paused');
    }

    await this.circuitBreaker.resumeTrading(dto.reason);
    return { message: `Trading resumed: ${dto.reason}`, state: this.circuitBreaker.getState() };
  }

  @Post('switch-to-live')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async switchToLive() {
    const result = await this.circuitBreaker.switchToLive();
    if (!result.success) {
      throw new BadRequestException(result.reason);
    }
    return { message: 'Switched to LIVE trading', state: this.circuitBreaker.getState() };
  }

  @Post('switch-to-paper')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async switchToPaper() {
    await this.circuitBreaker.switchToPaper();
    return { message: 'Switched to PAPER trading', state: this.circuitBreaker.getState() };
  }

  // Order validation - traders and admins
  @Post('validate-order')
  @Roles(UserRole.ADMIN, UserRole.TRADER)
  @HttpCode(HttpStatus.OK)
  async validateOrder(@Body() dto: ValidateOrderDto) {
    return this.orderValidation.validateOrder(dto);
  }

  @Post('refresh')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async refreshState() {
    await this.circuitBreaker.refreshState();
    return this.circuitBreaker.getState();
  }

  @Get('simulation')
  async getSimulationConfig() {
    return this.circuitBreaker.getSimulationConfig();
  }

  @Post('simulation')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async updateSimulationConfig(@Body() dto: UpdateSimulationConfigDto) {
    await this.circuitBreaker.updateSimulationConfig(dto);
    return { success: true, config: await this.circuitBreaker.getSimulationConfig() };
  }
}
