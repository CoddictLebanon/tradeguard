import { Controller, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { ActivityLog } from '../entities/activity-log.entity';
import { PolygonService } from '../data/polygon.service';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(
    private readonly positionsService: PositionsService,
    @InjectRepository(ActivityLog)
    private readonly activityRepo: Repository<ActivityLog>,
    private readonly polygonService: PolygonService,
  ) {}

  @Get()
  async getPositions() {
    return this.positionsService.findOpen();
  }

  @Get('all')
  async getAllPositions() {
    return this.positionsService.findAll();
  }

  @Get('stats')
  async getStats() {
    return this.positionsService.getPositionStats();
  }

  @Get(':id')
  async getPosition(@Param('id') id: string) {
    return this.positionsService.findById(id);
  }

  @Get(':id/activity')
  async getPositionActivity(@Param('id') id: string) {
    return this.activityRepo.find({
      where: { positionId: id },
      order: { createdAt: 'ASC' },
    });
  }

  @Get(':id/chart')
  async getPositionChart(@Param('id') id: string) {
    const position = await this.positionsService.findById(id);
    if (!position) {
      return [];
    }

    // Get bars from position open date to today
    const fromDate = new Date(position.openedAt);
    const toDate = new Date();

    // Format dates as YYYY-MM-DD
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];

    try {
      const bars = await this.polygonService.getBarsForDateRange(position.symbol, from, to);
      return bars.map((bar) => ({
        date: bar.timestamp instanceof Date
          ? bar.timestamp.toISOString().split('T')[0]
          : new Date(bar.timestamp).toISOString().split('T')[0],
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    } catch {
      return [];
    }
  }

  @Post(':id/close')
  async closePosition(@Param('id') id: string) {
    const result = await this.positionsService.closePosition(id);
    return {
      success: result.success,
      error: result.error,
      pnl: result.pnl,
      pnlPercent: result.pnlPercent,
    };
  }

  @Put(':id/trail')
  async updateTrailPercent(
    @Param('id') id: string,
    @Body() body: { trailPercent: number },
  ) {
    const result = await this.positionsService.updateTrailPercent(id, body.trailPercent);
    return { success: !!result };
  }

  @Post('sync-ib')
  async syncFromIB() {
    return this.positionsService.syncMissingFromIB();
  }
}
