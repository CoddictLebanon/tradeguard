import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { IBService } from '../ib/ib.service';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly ibService: IBService,
    private readonly polygonService: PolygonService,
  ) {}

  async findAll(): Promise<Position[]> {
    return this.positionRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOpen(): Promise<Position[]> {
    const positions = await this.positionRepo.find({
      where: { status: PositionStatus.OPEN },
      order: { openedAt: 'DESC' },
    });

    // Fetch live prices for all positions and update them
    if (positions.length > 0) {
      await this.refreshPositionPrices(positions);
    }

    return positions;
  }

  /**
   * Fetch live prices from Polygon and update positions
   */
  private async refreshPositionPrices(positions: Position[]): Promise<void> {
    const symbols = [...new Set(positions.map((p) => p.symbol))];

    // Fetch quotes for all unique symbols in parallel
    const quotePromises = symbols.map(async (symbol) => {
      try {
        const quote = await this.polygonService.getQuote(symbol);
        return { symbol, price: quote.price };
      } catch (error) {
        this.logger.warn(`Failed to get quote for ${symbol}: ${(error as Error).message}`);
        return null;
      }
    });

    const quotes = await Promise.all(quotePromises);
    const priceMap = new Map<string, number>();
    for (const q of quotes) {
      if (q) priceMap.set(q.symbol, q.price);
    }

    // Update each position with live price
    for (const position of positions) {
      const livePrice = priceMap.get(position.symbol);
      if (livePrice !== undefined && livePrice !== position.currentPrice) {
        position.currentPrice = livePrice;
        if (livePrice > (position.highestPrice || 0)) {
          position.highestPrice = livePrice;
        }
        // Save to database (fire and forget to not slow down response)
        this.positionRepo.save(position).catch((err) => {
          this.logger.error(`Failed to save position price: ${err.message}`);
        });
      }
    }
  }

  async findById(id: string): Promise<Position | null> {
    return this.positionRepo.findOne({ where: { id } });
  }

  async create(data: Partial<Position>): Promise<Position> {
    const position = this.positionRepo.create(data);
    return this.positionRepo.save(position);
  }

  async updateTrailPercent(id: string, trailPercent: number): Promise<Position | null> {
    const position = await this.positionRepo.findOne({ where: { id } });
    if (!position) return null;

    position.trailPercent = trailPercent;
    return this.positionRepo.save(position);
  }

  async updateCurrentPrice(id: string, currentPrice: number): Promise<Position | null> {
    const position = await this.positionRepo.findOne({ where: { id } });
    if (!position) return null;

    position.currentPrice = currentPrice;
    if (currentPrice > (position.highestPrice || 0)) {
      position.highestPrice = currentPrice;
    }
    return this.positionRepo.save(position);
  }

  async closePosition(id: string): Promise<Position | null> {
    const position = await this.positionRepo.findOne({ where: { id } });
    if (!position) return null;

    this.logger.log(`Closing position: ${position.shares} shares of ${position.symbol}`);

    try {
      // Fetch live price from Polygon before closing
      try {
        const quote = await this.polygonService.getQuote(position.symbol);
        position.currentPrice = quote.price;
        this.logger.log(`Fetched live exit price for ${position.symbol}: $${quote.price}`);
      } catch (priceErr) {
        this.logger.warn(`Failed to fetch live price for ${position.symbol}, using stored price: ${(priceErr as Error).message}`);
      }

      // Cancel any existing stop order first
      if (position.ibStopOrderId) {
        try {
          await this.ibService.cancelOrder(parseInt(position.ibStopOrderId, 10));
          this.logger.log(`Cancelled stop order ${position.ibStopOrderId}`);
        } catch (cancelErr) {
          this.logger.warn(`Failed to cancel stop order: ${(cancelErr as Error).message}`);
        }
      }

      // Place sell order to close the position
      const sellOrderId = await this.ibService.placeSellOrder(position.symbol, position.shares);
      this.logger.log(`Placed sell order ${sellOrderId} to close ${position.symbol}`);

      // Update position status
      position.status = PositionStatus.CLOSED;
      position.closedAt = new Date();
      const savedPosition = await this.positionRepo.save(position);

      // Calculate P&L for logging
      const entryValue = Number(position.shares) * Number(position.entryPrice);
      const exitValue = Number(position.shares) * Number(position.currentPrice);
      const pnl = exitValue - entryValue;
      const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

      // Log activity
      await this.activityRepo.save({
        type: ActivityType.POSITION_CLOSED,
        positionId: position.id,
        symbol: position.symbol,
        message: `Closed position: ${position.shares} shares of ${position.symbol}`,
        details: {
          id: position.id,
          shares: position.shares,
          entryPrice: position.entryPrice,
          exitPrice: position.currentPrice,
          pnl,
          pnlPercent,
          sellOrderId,
        },
      });

      return savedPosition;
    } catch (error) {
      this.logger.error(`Failed to close position ${position.symbol}: ${(error as Error).message}`);
      throw error;
    }
  }

  async getPositionStats(): Promise<{
    totalOpen: number;
    totalValue: number;
    unrealizedPnL: number;
  }> {
    const openPositions = await this.findOpen();

    const totalOpen = openPositions.length;
    const totalValue = openPositions.reduce(
      (sum, p) => sum + Number(p.shares) * Number(p.currentPrice || p.entryPrice),
      0,
    );
    const unrealizedPnL = openPositions.reduce((sum, p) => {
      const currentValue = Number(p.shares) * Number(p.currentPrice || p.entryPrice);
      const entryValue = Number(p.shares) * Number(p.entryPrice);
      return sum + (currentValue - entryValue);
    }, 0);

    return { totalOpen, totalValue, unrealizedPnL };
  }
}
