import { Controller, Post, Get, Delete, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SimulationService } from './simulation.service';
import { SimulationInput } from './simulation.types';

function validateSimulationInput(input: SimulationInput): void {
  // Validate entryDate format
  if (!input.entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    throw new BadRequestException('entryDate must be in YYYY-MM-DD format');
  }
  const entryDate = new Date(input.entryDate);
  if (isNaN(entryDate.getTime())) {
    throw new BadRequestException('entryDate is not a valid date');
  }
  if (entryDate > new Date()) {
    throw new BadRequestException('entryDate cannot be in the future');
  }

  // Validate numeric fields
  if (!input.symbol || typeof input.symbol !== 'string') {
    throw new BadRequestException('symbol is required');
  }
  if (typeof input.entryPrice !== 'number' || input.entryPrice <= 0) {
    throw new BadRequestException('entryPrice must be a positive number');
  }
  if (typeof input.shares !== 'number' || input.shares <= 0) {
    throw new BadRequestException('shares must be a positive number');
  }
  if (typeof input.stopPrice !== 'number' || input.stopPrice <= 0) {
    throw new BadRequestException('stopPrice must be a positive number');
  }
  if (input.maxDays !== undefined && (typeof input.maxDays !== 'number' || input.maxDays < 1)) {
    throw new BadRequestException('maxDays must be a positive number');
  }
}

@Controller('simulation')
@UseGuards(JwtAuthGuard)
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('run')
  async runSimulation(@Body() input: SimulationInput) {
    validateSimulationInput(input);
    return this.simulationService.runSimulation(input);
  }

  @Get('stats')
  async getStats() {
    return this.simulationService.getSimulationStats();
  }

  @Get('history')
  async getHistory(@Query('limit') limit?: string) {
    return this.simulationService.getSimulationHistory(limit ? parseInt(limit, 10) : 50);
  }

  @Delete('history')
  async clearHistory() {
    const count = await this.simulationService.clearSimulationHistory();
    return { cleared: count };
  }
}
