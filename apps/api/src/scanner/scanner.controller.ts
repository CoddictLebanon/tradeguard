import { Controller, Get, Post, Delete, Param, Body, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScannerService } from './scanner.service';
import { PositionSizingService } from '../risk/position-sizing.service';
import { PolygonService } from '../data/polygon.service';

function validateAsOfDate(asOfDate: string | undefined): void {
  if (!asOfDate) return;

  // Validate format is YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(asOfDate)) {
    throw new BadRequestException('asOfDate must be in YYYY-MM-DD format');
  }

  // Validate it's a valid date
  const parsedDate = new Date(asOfDate + 'T00:00:00Z');
  if (isNaN(parsedDate.getTime())) {
    throw new BadRequestException('asOfDate is not a valid date');
  }

  // Validate date is not in the future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inputDate = new Date(asOfDate + 'T00:00:00Z');
  if (inputDate > today) {
    throw new BadRequestException('asOfDate cannot be in the future');
  }
}

@Controller('scanner')
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(
    private readonly scannerService: ScannerService,
    private readonly positionSizingService: PositionSizingService,
    private readonly polygonService: PolygonService,
  ) {}

  @Get('opportunities')
  async getOpportunities() {
    return this.scannerService.getActiveOpportunities();
  }

  @Post('scan')
  async triggerScan(@Body() body: { symbols?: string[]; asOfDate?: string }) {
    validateAsOfDate(body.asOfDate);
    const result = await this.scannerService.manualScan(body.symbols, body.asOfDate);
    return {
      opportunities: result.opportunities,
      skipped: result.skipped,
      scannedCount: result.scannedCount,
      message: result.message,
    };
  }

  @Post('opportunities/:id/approve')
  async approveOpportunity(@Param('id') id: string) {
    const result = await this.scannerService.approveOpportunity(id);
    if (!result.opportunity) {
      return { success: false, error: 'Opportunity not found' };
    }
    return {
      success: result.trade?.success ?? false,
      error: result.trade?.error,
      positionId: result.trade?.positionId,
      shares: result.trade?.shares,
      entryPrice: result.trade?.entryPrice,
    };
  }

  @Post('opportunities/:id/reject')
  async rejectOpportunity(@Param('id') id: string) {
    const result = await this.scannerService.rejectOpportunity(id);
    return { success: !!result };
  }

  // Debug endpoint to see qualification results
  @Get('qualify')
  async getQualificationResults(
    @Query('symbols') symbols?: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    validateAsOfDate(asOfDate);
    const symbolList = symbols ? symbols.split(',').map(s => s.trim().toUpperCase()) : undefined;
    return this.scannerService.getQualificationResults(symbolList, asOfDate);
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

  // Get live quotes for multiple symbols (for real-time price updates)
  // Uses batch API to minimize Polygon API calls (1 call for all symbols)
  @Post('quotes')
  async getQuotes(@Body() body: { symbols: string[] }) {
    const { symbols } = body;

    if (!symbols || symbols.length === 0) {
      return {};
    }

    const quotes: Record<string, { price: number; change?: number; changePercent?: number }> = {};

    // Use batch endpoint - single API call for all symbols
    const batchQuotes = await this.polygonService.getQuotesBatch(symbols);

    for (const [symbol, quote] of batchQuotes) {
      quotes[symbol] = {
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      };
    }

    return quotes;
  }
}
