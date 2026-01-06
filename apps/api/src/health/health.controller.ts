import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { HealthService, SystemHealth } from './health.service';
import { ReconciliationService, ReconciliationResult } from './reconciliation.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  // Public endpoint for uptime monitors (no auth required)
  @Public()
  @Get()
  async getQuickHealth(): Promise<{ status: string }> {
    const health = await this.healthService.runHealthChecks();
    return { status: health.status };
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard)
  async getDetailedHealth(): Promise<SystemHealth> {
    return this.healthService.runHealthChecks();
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getHealthHistory(@Query('hours') hours?: string) {
    const hoursNum = hours ? parseInt(hours, 10) : 24;
    return this.healthService.getHealthHistory(hoursNum);
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  async triggerReconciliation(
    @Query('dryRun') dryRun?: string,
  ): Promise<ReconciliationResult> {
    const isDryRun = dryRun === 'true';
    return this.reconciliationService.reconcile(isDryRun);
  }
}
