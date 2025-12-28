import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
  ) {}

  async findAll(): Promise<Position[]> {
    return this.positionRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOpen(): Promise<Position[]> {
    return this.positionRepo.find({
      where: { status: PositionStatus.OPEN },
      order: { openedAt: 'DESC' },
    });
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

    position.status = PositionStatus.CLOSED;
    position.closedAt = new Date();
    return this.positionRepo.save(position);
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
