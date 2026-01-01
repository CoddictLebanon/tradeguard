import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityService } from './activity.service';
import { ActivityFeedQueryDto, ActivityFeedResponse } from './dto/activity-feed.dto';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
  ) {}

  @Get()
  async getActivityLog(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    return this.activityService.getRecentLogs(take);
  }

  @Get('feed')
  async getFeed(@Query() query: ActivityFeedQueryDto): Promise<ActivityFeedResponse> {
    return this.activityService.getFeed(query);
  }
}
