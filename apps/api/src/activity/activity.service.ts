import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, LessThanOrEqual, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import { ActivityFeedQueryDto, ActivityFeedResponse, ActivityFeedItem } from './dto/activity-feed.dto';

@Injectable()
export class ActivityService {
  // Trade event types only
  private readonly TRADE_EVENT_TYPES = [
    ActivityType.POSITION_OPENED,
    ActivityType.POSITION_CLOSED,
    ActivityType.TRAILING_STOP_UPDATED,
  ];

  constructor(
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
  ) {}

  async getFeed(query: ActivityFeedQueryDto): Promise<ActivityFeedResponse> {
    const { startDate, endDate, type, symbol, outcome, limit = 50, offset = 0 } = query;

    const whereClause: FindOptionsWhere<ActivityLog> = {
      type: type ? type : In(this.TRADE_EVENT_TYPES),
    };

    // Parse dates - handle both ISO strings and date-only strings
    const parseStartDate = (d: string) => new Date(d);
    const parseEndDate = (d: string) => {
      // If it's a date-only string (YYYY-MM-DD), add end of day
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return new Date(d + 'T23:59:59.999Z');
      }
      // Otherwise use as-is (already full ISO string)
      return new Date(d);
    };

    if (startDate && endDate) {
      whereClause.createdAt = Between(parseStartDate(startDate), parseEndDate(endDate));
    } else if (startDate) {
      whereClause.createdAt = MoreThanOrEqual(parseStartDate(startDate));
    } else if (endDate) {
      whereClause.createdAt = LessThanOrEqual(parseEndDate(endDate));
    }

    if (symbol) {
      whereClause.symbol = symbol.toUpperCase();
    }

    const [items, total] = await this.activityRepo.findAndCount({
      where: whereClause,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // Filter by outcome if specified (for closed positions only)
    let filteredItems = items;
    if (outcome) {
      filteredItems = items.filter((item) => {
        if (item.type !== ActivityType.POSITION_CLOSED) return false;
        const pnl = item.details?.pnl as number | undefined;
        if (outcome === 'win') return pnl !== undefined && pnl > 0;
        if (outcome === 'loss') return pnl !== undefined && pnl <= 0;
        return true;
      });
    }

    const feedItems: ActivityFeedItem[] = filteredItems.map((item) => ({
      id: item.id,
      timestamp: item.createdAt.toISOString(),
      type: item.type,
      symbol: item.symbol,
      message: item.message,
      details: {
        entryPrice: item.details?.entryPrice as number | undefined,
        exitPrice: item.details?.exitPrice as number | undefined,
        stopPrice: item.details?.stopPrice as number | undefined,
        oldStopPrice: item.details?.oldStopPrice as number | undefined,
        newStopPrice: item.details?.newStopPrice as number | undefined,
        pnl: item.details?.pnl as number | undefined,
        outcome: item.details?.pnl !== undefined ? ((item.details.pnl as number) > 0 ? 'win' : 'loss') : undefined,
        shares: item.details?.shares as number | undefined,
      },
      positionId: item.positionId,
    }));

    // After filtering, recalculate for outcome filtering
    const actualTotal = outcome ? filteredItems.length : total;

    return {
      items: feedItems,
      total: actualTotal,
      hasMore: outcome ? false : (offset + limit < total), // Can't accurately paginate with post-filter
    };
  }

  async getRecentLogs(limit: number = 50): Promise<ActivityLog[]> {
    const take = Math.min(limit, 200);
    return this.activityRepo.find({
      order: { createdAt: 'DESC' },
      take,
    });
  }
}
