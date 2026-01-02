import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CronLogService } from './cron-log.service';

@Controller('cron-logs')
@UseGuards(JwtAuthGuard)
export class CronLogController {
  constructor(private cronLogService: CronLogService) {}

  @Get()
  async getLogs(
    @Query('jobName') jobName: string = 'trailing_stop_reassessment',
    @Query('limit') limit: string = '50',
  ) {
    const logs = await this.cronLogService.getLogs(jobName, parseInt(limit, 10));
    return { logs };
  }
}
