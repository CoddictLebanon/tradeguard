import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistItem } from '../entities/watchlist.entity';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    @InjectRepository(WatchlistItem)
    private watchlistRepo: Repository<WatchlistItem>,
  ) {}

  async findAll(): Promise<WatchlistItem[]> {
    return this.watchlistRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findActive(): Promise<WatchlistItem[]> {
    return this.watchlistRepo.find({
      where: { active: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findBySymbol(symbol: string): Promise<WatchlistItem | null> {
    return this.watchlistRepo.findOne({
      where: { symbol: symbol.toUpperCase() },
    });
  }

  async add(symbol: string, notes?: string): Promise<WatchlistItem> {
    const upperSymbol = symbol.toUpperCase();

    const existing = await this.findBySymbol(upperSymbol);
    if (existing) {
      throw new ConflictException(`${upperSymbol} is already in watchlist`);
    }

    const item = this.watchlistRepo.create({
      symbol: upperSymbol,
      notes,
      active: true,
    });

    return this.watchlistRepo.save(item);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.watchlistRepo.delete(id);
    return (result.affected || 0) > 0;
  }

  async toggleActive(id: string): Promise<WatchlistItem | null> {
    const item = await this.watchlistRepo.findOne({ where: { id } });
    if (!item) return null;

    item.active = !item.active;
    return this.watchlistRepo.save(item);
  }

  async updateNotes(id: string, notes: string): Promise<WatchlistItem | null> {
    const item = await this.watchlistRepo.findOne({ where: { id } });
    if (!item) return null;

    item.notes = notes;
    return this.watchlistRepo.save(item);
  }
}
