import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { Trade, ExitReason } from '../entities/trade.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';

interface OrderStatusEvent {
  orderId: number;
  status: string;
  filled: number;
  remaining: number;
  avgFillPrice: number;
  isPaper?: boolean;
}

interface ExecutionEvent {
  reqId: number;
  contract: { symbol: string };
  execution: {
    side: string;
    shares: number;
    price: number;
    orderId: number;
    isPaper?: boolean;
  };
}

@Injectable()
export class IBEventsService {
  private readonly logger = new Logger(IBEventsService.name);
  private processingOrders = new Set<number>(); // Prevent race conditions

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('ib.orderStatus')
  async handleOrderStatus(event: OrderStatusEvent) {
    const prefix = event.isPaper ? '[PAPER] ' : '';
    this.logger.log(`${prefix}Order ${event.orderId} status: ${event.status}`);

    // Prevent processing the same order concurrently
    if (this.processingOrders.has(event.orderId)) {
      this.logger.warn(`Order ${event.orderId} is already being processed, skipping`);
      return;
    }

    try {
      this.processingOrders.add(event.orderId);

      if (event.status === 'Filled') {
        await this.handleOrderFilled(event);
      } else if (event.status === 'Cancelled') {
        await this.handleOrderCancelled(event);
      }
    } finally {
      this.processingOrders.delete(event.orderId);
    }
  }

  @OnEvent('ib.execution')
  async handleExecution(event: ExecutionEvent) {
    const { contract, execution } = event;

    this.logger.log(
      `Execution: ${execution.side} ${execution.shares} ${contract.symbol} @ ${execution.price}`,
    );

    await this.activityRepo.save({
      type: ActivityType.ORDER_FILLED,
      message: `${execution.side} ${execution.shares} ${contract.symbol} @ $${execution.price}`,
      symbol: contract.symbol,
      details: {
        orderId: execution.orderId,
        side: execution.side,
        shares: execution.shares,
        price: execution.price,
      },
    });
  }

  private async handleOrderFilled(event: OrderStatusEvent) {
    // Check if this is an entry order
    const entryPosition = await this.positionRepo.findOne({
      where: { ibOrderId: event.orderId.toString(), status: PositionStatus.PENDING },
    });

    if (entryPosition) {
      entryPosition.status = PositionStatus.OPEN;
      entryPosition.entryPrice = event.avgFillPrice;
      entryPosition.highestPrice = event.avgFillPrice;
      entryPosition.currentPrice = event.avgFillPrice;
      entryPosition.openedAt = new Date();
      await this.positionRepo.save(entryPosition);

      await this.activityRepo.save({
        type: ActivityType.ORDER_FILLED,
        message: `Opened position: ${entryPosition.shares} ${entryPosition.symbol} @ $${event.avgFillPrice}`,
        symbol: entryPosition.symbol,
        details: { positionId: entryPosition.id, avgFillPrice: event.avgFillPrice },
      });
      return;
    }

    // Check if this is a stop order (exit)
    const exitPosition = await this.positionRepo.findOne({
      where: { ibStopOrderId: event.orderId.toString(), status: PositionStatus.OPEN },
    });

    if (exitPosition) {
      await this.closePosition(exitPosition, event.avgFillPrice, ExitReason.STOP_LOSS);
    }
  }

  private async handleOrderCancelled(event: OrderStatusEvent) {
    this.logger.log(`Order ${event.orderId} was cancelled`);
  }

  private async closePosition(
    position: Position,
    exitPrice: number,
    exitReason: ExitReason,
  ) {
    const pnl = (exitPrice - Number(position.entryPrice)) * position.shares;
    const pnlPercent = ((exitPrice - Number(position.entryPrice)) / Number(position.entryPrice)) * 100;

    // Use transaction to ensure atomicity
    await this.dataSource.transaction(async (manager) => {
      // Create trade record
      await manager.save(Trade, {
        symbol: position.symbol,
        entryPrice: position.entryPrice,
        exitPrice,
        shares: position.shares,
        pnl,
        pnlPercent,
        openedAt: position.openedAt,
        closedAt: new Date(),
        exitReason,
      });

      // Update position
      position.status = PositionStatus.CLOSED;
      position.closedAt = new Date();
      await manager.save(Position, position);

      await manager.save(ActivityLog, {
        type: ActivityType.POSITION_CLOSED,
        message: `Closed ${position.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
        symbol: position.symbol,
        details: { positionId: position.id, exitPrice, pnl, pnlPercent, exitReason },
      });
    });

    this.logger.log(
      `Position closed: ${position.symbol} PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
    );
  }
}
