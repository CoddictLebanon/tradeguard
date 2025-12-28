import { Controller, Get, Post, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScannerService } from './scanner.service';
import { PositionSizingService } from '../risk/position-sizing.service';

@Controller('scanner')
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(
    private readonly scannerService: ScannerService,
    private readonly positionSizingService: PositionSizingService,
  ) {}

  @Get('opportunities')
  async getOpportunities() {
    return this.scannerService.getActiveOpportunities();
  }

  @Post('scan')
  async triggerScan(@Body() body: { symbols?: string[]; asOfDate?: string }) {
    const opportunities = await this.scannerService.manualScan(body.symbols, body.asOfDate);
    return { opportunities };
  }

  @Post('opportunities/:id/approve')
  async approveOpportunity(@Param('id') id: string) {
    const result = await this.scannerService.approveOpportunity(id);
    return { success: !!result };
  }

  @Post('opportunities/:id/reject')
  async rejectOpportunity(@Param('id') id: string) {
    const result = await this.scannerService.rejectOpportunity(id);
    return { success: !!result };
  }

  // Debug endpoint to see qualification results
  @Get('qualify')
  async getQualificationResults(@Query('symbols') symbols?: string) {
    const symbolList = symbols ? symbols.split(',').map(s => s.trim().toUpperCase()) : undefined;
    return this.scannerService.getQualificationResults(symbolList);
  }

  @Delete('opportunities/pending')
  async clearPendingOpportunities() {
    const count = await this.scannerService.clearPendingOpportunities();
    return { cleared: count };
  }

  @Post('opportunities/dedup')
  async removeDuplicates() {
    const count = await this.scannerService.removeDuplicates();
    return { removed: count };
  }

  // Calculate position size for approval confirmation
  @Post('opportunities/:id/calculate')
  async calculatePositionSize(@Param('id') id: string) {
    const opportunity = await this.scannerService.getOpportunityById(id);
    if (!opportunity) {
      return { status: 'REJECT', reason: 'Opportunity not found' };
    }

    const pullbackLow = Number(opportunity.factors?.pullbackLow) || 0;
    const entry = Number(opportunity.currentPrice);

    if (!pullbackLow || !entry) {
      return {
        status: 'REJECT',
        symbol: opportunity.symbol,
        reason: 'Missing pullbackLow or entry price',
        entry,
        stop: null,
        stop_pct: null,
      };
    }

    return this.positionSizingService.calculateSwingPosition({
      symbol: opportunity.symbol,
      entry,
      pullbackLow,
    });
  }

  // Get account config for display
  @Get('config')
  async getAccountConfig() {
    return {
      account: this.positionSizingService.getAccountConfig(),
      risk: this.positionSizingService.getRiskLimits(),
    };
  }

  // Update account config (capital, risk per trade, buffer)
  @Post('config')
  async updateAccountConfig(
    @Body()
    body: {
      totalCapital?: number;
      riskPerTradePercent?: number;
      stopBuffer?: number;
      maxCapitalDeployedPercent?: number;
    },
  ) {
    await this.positionSizingService.updateAccountConfig(body);
    return { success: true };
  }
}
