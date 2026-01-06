import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortfolioService, PerformanceData } from './portfolio.service';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('performance')
  async getPerformance(
    @Query('period') period: string = '1m',
  ): Promise<PerformanceData> {
    return this.portfolioService.getPerformance(period);
  }

  @Post('snapshot')
  async takeSnapshot() {
    const snapshot = await this.portfolioService.takeSnapshot();
    return { success: !!snapshot, snapshot };
  }
}
