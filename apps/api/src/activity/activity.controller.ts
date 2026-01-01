import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityService } from './activity.service';
import { ActivityFeedQueryDto, ActivityFeedResponse } from './dto/activity-feed.dto';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly activityService: ActivityService,
  ) {}

  @Get()
  async getActivityLog(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    return this.activityRepo.find({
      order: { createdAt: 'DESC' },
      take,
    });
  }

  @Get('feed')
  async getFeed(@Query() query: ActivityFeedQueryDto): Promise<ActivityFeedResponse> {
    return this.activityService.getFeed(query);
  }
}
