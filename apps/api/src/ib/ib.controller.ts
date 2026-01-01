import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { IBService } from './ib.service';
import { IBProxyManagerService } from './ib-proxy-manager.service';
import { PlaceBuyOrderDto, PlaceSellOrderDto, ModifyStopDto } from './dto/place-order.dto';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { OrderValidationService } from '../safety/order-validation.service';

@Controller('ib')
export class IBController {
  constructor(
    private readonly ibService: IBService,
    private readonly proxyManager: IBProxyManagerService,
    private readonly orderValidation: OrderValidationService,
  ) {}

  @Get('status')
  getStatus() {
    return {
      connected: this.ibService.isConnected(),
      status: this.ibService.getConnectionStatus(),
      tradingMode: this.ibService.getTradingMode(),
      proxy: this.proxyManager.getStatus(),
    };
  }

  @Get('proxy/status')
  getProxyStatus() {
    return this.proxyManager.getStatus();
  }

  @Post('proxy/restart')
  @Roles(UserRole.ADMIN)
  async restartProxy() {
    await this.proxyManager.restart();
    return { message: 'Proxy restart initiated', status: this.proxyManager.getStatus() };
  }

  private requireConnection(): void {
    // Paper mode doesn't require IB connection
    if (this.ibService.isPaperMode()) {
      return;
    }
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get('account')
  async getAccountSummary() {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getAccountSummary();
  }

  @Get('positions')
  async getPositions() {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getPositions();
  }

  @Get('quote/:symbol')
  async getQuote(@Param('symbol') symbol: string) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getQuote(symbol.toUpperCase());
  }

  @Post('order/buy')
  @Roles(UserRole.ADMIN, UserRole.TRADER)
  async placeBuyOrder(@Body() dto: PlaceBuyOrderDto) {
    this.requireConnection();

    // Validate order before placement
    const price = dto.limitPrice || 100; // Use limit price or estimate
    const portfolioValue = 1000000; // TODO: Get from account summary
    const validation = await this.orderValidation.validateBuyOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      price,
      portfolioValue,
    );

    if (!validation.valid) {
      throw new HttpException(
        { message: 'Order validation failed', errors: validation.errors },
        HttpStatus.BAD_REQUEST,
      );
    }

    const quantity = validation.adjustedQuantity || dto.quantity;

    const buyOrderId = await this.ibService.placeBuyOrder(
      dto.symbol.toUpperCase(),
      quantity,
      dto.limitPrice,
    );

    const stopOrderId = await this.ibService.placeTrailingStopOrder(
      dto.symbol.toUpperCase(),
      quantity,
      dto.trailPercent,
    );

    return {
      buyOrderId,
      stopOrderId,
      quantity,
      warnings: validation.warnings,
      message: `Buy order placed with trailing stop at ${dto.trailPercent}%`,
    };
  }

  @Post('order/sell')
  @Roles(UserRole.ADMIN, UserRole.TRADER)
  async placeSellOrder(@Body() dto: PlaceSellOrderDto) {
    this.requireConnection();

    // Validate sell order
    const price = dto.limitPrice || 100;
    const portfolioValue = 1000000;
    const validation = await this.orderValidation.validateSellOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      price,
      portfolioValue,
    );

    if (!validation.valid) {
      throw new HttpException(
        { message: 'Order validation failed', errors: validation.errors },
        HttpStatus.BAD_REQUEST,
      );
    }

    const orderId = await this.ibService.placeSellOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.limitPrice,
    );

    return { orderId, warnings: validation.warnings };
  }

  @Post('order/modify-stop')
  @Roles(UserRole.ADMIN, UserRole.TRADER)
  async modifyStop(@Body() dto: ModifyStopDto) {
    this.requireConnection();

    await this.ibService.modifyTrailingStop(
      dto.orderId,
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.trailPercent,
    );

    return { message: 'Stop order modified' };
  }

  @Delete('order/:orderId')
  @Roles(UserRole.ADMIN, UserRole.TRADER)
  async cancelOrder(@Param('orderId') orderId: string) {
    this.requireConnection();

    await this.ibService.cancelOrder(parseInt(orderId, 10));
    return { message: 'Order cancelled' };
  }

  @Post('reconnect')
  @Roles(UserRole.ADMIN)
  async reconnect() {
    try {
      await this.ibService.disconnect();
      await this.ibService.connect();
      return { status: this.ibService.getConnectionStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      throw new HttpException(
        {
          message: `Failed to connect to IB: ${message}. Make sure TWS or IB Gateway is running with API connections enabled on port 7497.`,
          status: this.ibService.getConnectionStatus(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
