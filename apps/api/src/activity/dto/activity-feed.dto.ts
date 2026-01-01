import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ActivityType } from '../../entities/activity-log.entity';

export class ActivityFeedQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsEnum(['win', 'loss'])
  outcome?: 'win' | 'loss';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  type: ActivityType;
  symbol: string | null;
  message: string;
  details: {
    entryPrice?: number;
    exitPrice?: number;
    stopPrice?: number;
    oldStopPrice?: number;
    newStopPrice?: number;
    pnl?: number;
    outcome?: 'win' | 'loss';
    shares?: number;
  };
  positionId: string | null;
}

export interface ActivityFeedResponse {
  items: ActivityFeedItem[];
  total: number;
  hasMore: boolean;
}
