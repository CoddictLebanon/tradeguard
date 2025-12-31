import { Controller, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { ActivityLog } from '../entities/activity-log.entity';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(
    private readonly positionsService: PositionsService,
    @InjectRepository(ActivityLog)
    private readonly activityRepo: Repository<ActivityLog>,
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

  @Post(':id/close')
  async closePosition(@Param('id') id: string) {
    const result = await this.positionsService.closePosition(id);
    return { success: !!result };
  }

  @Put(':id/trail')
  async updateTrailPercent(
    @Param('id') id: string,
    @Body() body: { trailPercent: number },
  ) {
    const result = await this.positionsService.updateTrailPercent(id, body.trailPercent);
    return { success: !!result };
  }
}
