import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(): Promise<Position[]> {
    return this.positionRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOpen(): Promise<Position[]> {
    // Fetch positions from IB as the source of truth
    try {
      return await this.findOpenFromIB();
    } catch (err) {
      this.logger.warn(`Failed to fetch from IB, falling back to database: ${(err as Error).message}`);
      // Fallback to database-only mode
      const positions = await this.positionRepo.find({
        where: { status: PositionStatus.OPEN },
        order: { openedAt: 'DESC' },
      });
      if (positions.length > 0) {
        await this.refreshPositionPrices(positions);
      }
      return positions;
    }
  }

  /**
   * Fetch positions from IB Gateway and merge with database metadata
   * IB is the SOURCE OF TRUTH for:
   *   - shares (position count)
   *   - entryPrice (avgCost = average cost basis)
   * Polygon provides:
   *   - currentPrice (live market price)
   * Database provides:
   *   - stopPrice, trailPercent, openedAt (metadata)
   */
  async findOpenFromIB(): Promise<Position[]> {
    // Get IB positions - this is the source of truth
    const ibPositions = await this.ibService.getPositionsFromProxy();

    // Get database positions for metadata (stop price, trail percent, etc.)
    const dbPositions = await this.positionRepo.find({
      where: { status: PositionStatus.OPEN },
    });
    const dbMap = new Map(dbPositions.map(p => [p.symbol, p]));

    const mergedPositions: Position[] = [];

    // Fetch live prices for all symbols in parallel
    const symbols = ibPositions.map(p => p.symbol);
    const livePrices = new Map<string, number>();

    await Promise.all(symbols.map(async (symbol) => {
      try {
        const quote = await this.polygonService.getQuote(symbol);
        livePrices.set(symbol, quote.price);
      } catch {
        // Will fallback to avgCost if Polygon fails
      }
    }));

    for (const ibPos of ibPositions) {
      const dbPos = dbMap.get(ibPos.symbol);
      const livePrice = livePrices.get(ibPos.symbol);

      if (dbPos) {
        // IB is authoritative for shares and entry price
        dbPos.shares = Math.round(ibPos.position);
        dbPos.entryPrice = ibPos.avgCost; // IB's avgCost IS the entry price

        // Polygon is authoritative for current price
        if (livePrice !== undefined) {
          dbPos.currentPrice = livePrice;
          if (livePrice > (dbPos.highestPrice || 0)) {
            dbPos.highestPrice = livePrice;
          }
        } else {
          // Fallback: use entry price if no live price available
          dbPos.currentPrice = ibPos.avgCost;
        }

        mergedPositions.push(dbPos);
        dbMap.delete(ibPos.symbol); // Mark as processed
      } else {
        // Position exists in IB but not in DB - create a virtual position
        this.logger.warn(`Position ${ibPos.symbol} exists in IB but not in database`);

        const currentPrice = livePrice ?? ibPos.avgCost;

        const virtualPos = this.positionRepo.create({
          id: `ib-${ibPos.symbol}`, // Temporary ID
          symbol: ibPos.symbol,
          shares: Math.round(ibPos.position),
          entryPrice: ibPos.avgCost, // IB's avgCost IS the entry price
          currentPrice,
          highestPrice: currentPrice,
          status: PositionStatus.OPEN,
          trailPercent: 0,
          openedAt: new Date(),
        });
        mergedPositions.push(virtualPos);
      }
    }

    // Log any DB positions that aren't in IB (stale - should be closed)
    for (const [symbol] of dbMap) {
      this.logger.warn(`Position ${symbol} exists in database but NOT in IB - marking as stale`);
    }

    return mergedPositions.sort((a, b) =>
      new Date(b.openedAt || 0).getTime() - new Date(a.openedAt || 0).getTime()
    );
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

  async closePosition(id: string): Promise<{
    success: boolean;
    error?: string;
    position?: Position;
    pnl?: number;
    pnlPercent?: number;
  }> {
    const position = await this.positionRepo.findOne({ where: { id } });
    if (!position) {
      return { success: false, error: 'Position not found' };
    }

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
      let sellOrderId: number;
      try {
        sellOrderId = await this.ibService.placeSellOrder(position.symbol, position.shares);
        this.logger.log(`Placed sell order ${sellOrderId} to close ${position.symbol}`);
      } catch (sellErr) {
        const errorMsg = (sellErr as Error).message;
        this.logger.error(`Failed to place sell order for ${position.symbol}: ${errorMsg}`);
        return { success: false, error: `IB sell order failed: ${errorMsg}` };
      }

      // CRITICAL: Verify the position is closed in IB before updating database
      await new Promise(resolve => setTimeout(resolve, 1500));

      let ibCloseVerified = false;
      try {
        const ibPositions = await this.ibService.getPositionsFromProxy();
        const ibPosition = ibPositions.find(p => p.symbol === position.symbol);

        if (!ibPosition || ibPosition.position === 0) {
          ibCloseVerified = true;
          this.logger.log(`IB VERIFIED: ${position.symbol} position closed`);
        } else {
          this.logger.warn(`IB still shows ${ibPosition.position} shares of ${position.symbol}`);
        }
      } catch (verifyErr) {
        this.logger.error(`Failed to verify IB close: ${(verifyErr as Error).message}`);
      }

      if (!ibCloseVerified) {
        return {
          success: false,
          error: `Sell order placed (ID: ${sellOrderId}) but position still exists in IB. Check IB Gateway manually.`,
        };
      }

      // IB CONFIRMED CLOSED - Now safe to update the database
      position.status = PositionStatus.CLOSED;
      position.closedAt = new Date();
      const savedPosition = await this.positionRepo.save(position);

      // Calculate P&L
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

      // Emit event for Telegram notifications
      this.eventEmitter.emit('activity.trade', {
        type: ActivityType.POSITION_CLOSED,
        symbol: position.symbol,
        details: { exitPrice: position.currentPrice, pnl },
      });

      return {
        success: true,
        position: savedPosition,
        pnl,
        pnlPercent,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.logger.error(`Failed to close position ${position.symbol}: ${errorMsg}`);
      return { success: false, error: `Failed to close position: ${errorMsg}` };
    }
  }

  /**
   * Sync missing IB positions to the database
   * For positions that exist in IB but not in the database
   */
  async syncMissingFromIB(): Promise<{ synced: string[]; errors: string[] }> {
    const synced: string[] = [];
    const errors: string[] = [];

    try {
      const ibPositions = await this.ibService.getPositionsFromProxy();
      const dbPositions = await this.positionRepo.find({
        where: { status: PositionStatus.OPEN },
      });
      const dbSymbols = new Set(dbPositions.map(p => p.symbol));

      // Fetch live prices in parallel
      const livePrices = new Map<string, number>();
      await Promise.all(ibPositions.map(async (ibPos) => {
        try {
          const quote = await this.polygonService.getQuote(ibPos.symbol);
          livePrices.set(ibPos.symbol, quote.price);
        } catch {
          // Will use avgCost as fallback
        }
      }));

      for (const ibPos of ibPositions) {
        if (!dbSymbols.has(ibPos.symbol) && ibPos.position > 0) {
          this.logger.log(`Syncing IB position to database: ${ibPos.symbol}`);

          const currentPrice = livePrices.get(ibPos.symbol) ?? ibPos.avgCost;
          // Use a default stop of 5% below entry as starting point
          const defaultStopPercent = 0.05;
          const stopPrice = ibPos.avgCost * (1 - defaultStopPercent);

          try {
            const position = this.positionRepo.create({
              symbol: ibPos.symbol,
              shares: Math.round(ibPos.position),
              entryPrice: ibPos.avgCost,
              currentPrice,
              highestPrice: currentPrice,
              stopPrice,
              trailPercent: defaultStopPercent * 100,
              status: PositionStatus.OPEN,
              openedAt: new Date(), // Approximate since we don't know actual open time
            });

            await this.positionRepo.save(position);

            // Log activity
            await this.activityRepo.save({
              type: ActivityType.SYSTEM,
              positionId: position.id,
              symbol: ibPos.symbol,
              message: `Synced IB position to database: ${Math.round(ibPos.position)} shares of ${ibPos.symbol}`,
              details: {
                source: 'ib_sync',
                shares: Math.round(ibPos.position),
                avgCost: ibPos.avgCost,
              },
            });

            synced.push(ibPos.symbol);
          } catch (saveErr) {
            const errMsg = `Failed to save ${ibPos.symbol}: ${(saveErr as Error).message}`;
            this.logger.error(errMsg);
            errors.push(errMsg);
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to fetch IB positions: ${(err as Error).message}`);
    }

    this.logger.log(`Synced ${synced.length} positions from IB, ${errors.length} errors`);
    return { synced, errors };
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
