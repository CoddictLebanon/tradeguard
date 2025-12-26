import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IBService } from './ib.service';
import { PlaceBuyOrderDto, PlaceSellOrderDto, ModifyStopDto } from './dto/place-order.dto';

@Controller('ib')
export class IBController {
  constructor(private readonly ibService: IBService) {}

  @Get('status')
  getStatus() {
    return {
      connected: this.ibService.isConnected(),
      status: this.ibService.getConnectionStatus(),
    };
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
  async placeBuyOrder(@Body() dto: PlaceBuyOrderDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const buyOrderId = await this.ibService.placeBuyOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.limitPrice,
    );

    const stopOrderId = await this.ibService.placeTrailingStopOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.trailPercent,
    );

    return {
      buyOrderId,
      stopOrderId,
      message: `Buy order placed with trailing stop at ${dto.trailPercent}%`,
    };
  }

  @Post('order/sell')
  async placeSellOrder(@Body() dto: PlaceSellOrderDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const orderId = await this.ibService.placeSellOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.limitPrice,
    );

    return { orderId };
  }

  @Post('order/modify-stop')
  async modifyStop(@Body() dto: ModifyStopDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.ibService.modifyTrailingStop(
      dto.orderId,
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.trailPercent,
    );

    return { message: 'Stop order modified' };
  }

  @Delete('order/:orderId')
  async cancelOrder(@Param('orderId') orderId: string) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.ibService.cancelOrder(parseInt(orderId, 10));
    return { message: 'Order cancelled' };
  }

  @Post('reconnect')
  async reconnect() {
    await this.ibService.disconnect();
    await this.ibService.connect();
    return { status: this.ibService.getConnectionStatus() };
  }
}
