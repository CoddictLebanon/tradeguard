import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity, OpportunityStatus } from '../entities/opportunity.entity';
import { BuyQualificationService, QualificationResult } from '../strategy/buy-qualification.service';
import { AIService } from '../ai/ai.service';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private isScanning = false;
  private scanStartTime: number | null = null;
  private readonly SCAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

  constructor(
    @InjectRepository(WatchlistItem)
    private watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(Opportunity)
    private opportunityRepo: Repository<Opportunity>,
    private readonly buyQualificationService: BuyQualificationService,
    private readonly aiService: AIService,
    private readonly polygonService: PolygonService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Run every 5 minutes during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  @Cron('*/5 9-16 * * 1-5', { timeZone: 'America/New_York' })
  async scheduledScan() {
    const now = new Date();
    const hours = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    const minutes = now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' });

    const hour = parseInt(hours, 10);
    const minute = parseInt(minutes, 10);

    // More precise market hours check
    if (hour === 9 && minute < 30) return;
    if (hour >= 16) return;

    await this.scanWatchlist();
  }

  async scanWatchlist(asOfDate?: string): Promise<Opportunity[]> {
    // Check if previous scan is stuck (timed out)
    if (this.isScanning && this.scanStartTime) {
      const elapsed = Date.now() - this.scanStartTime;
      if (elapsed > this.SCAN_TIMEOUT_MS) {
        this.logger.warn(`Previous scan timed out after ${Math.round(elapsed / 1000)}s, resetting flag`);
        this.isScanning = false;
        this.scanStartTime = null;
      }
    }

    if (this.isScanning) {
      this.logger.warn('Scan already in progress, skipping');
      return [];
    }

    this.isScanning = true;
    this.scanStartTime = Date.now();
    this.logger.log('Starting watchlist scan with buy qualification criteria');

    try {
      // Get active watchlist items
      const watchlist = await this.watchlistRepo.find({
        where: { active: true },
      });

      if (watchlist.length === 0) {
        this.logger.log('No items in watchlist');
        return [];
      }

      const symbols = watchlist.map((item) => item.symbol);
      this.logger.log(`Scanning ${symbols.length} symbols for buy qualification`);

      // Run buy qualification on all symbols
      const qualificationResults = await this.buyQualificationService.qualifyMultiple(symbols, asOfDate);

      // Filter to successful results with metrics
      const successfulResults = qualificationResults.filter(r => r.success && r.metrics);
      this.logger.log(`${successfulResults.length} stocks have complete metrics`);

      // Log some failed stocks for debugging
      const failed = qualificationResults.filter(r => !r.success).slice(0, 5);
      for (const f of failed) {
        this.logger.debug(`${f.symbol} failed: ${f.error}`);
      }

      const opportunities: Opportunity[] = [];

      for (const result of successfulResults) {
        const metrics = result.metrics!;

        // Check if we already have a pending or approved opportunity for this symbol
        const existing = await this.opportunityRepo.findOne({
          where: {
            symbol: result.symbol,
            status: In([OpportunityStatus.PENDING, OpportunityStatus.APPROVED]),
            expiresAt: MoreThan(new Date()),
          },
        });

        // Store all metrics in factors as numbers/strings for JSON
        const factors: Record<string, number | string | boolean> = {
          // 1) Liquidity
          adv45: metrics.adv45,
          // 2) SMA200
          sma200: metrics.sma200,
          // 3) Trend
          sma200_20daysAgo: metrics.sma200_20daysAgo,
          slope: metrics.slope,
          trendState: metrics.trendState,
          // 4) Extended percentage
          extPct: metrics.extPct,
          // 5) Recent high
          recentHigh: metrics.recentHigh,
          recentHighDate: metrics.recentHighDate,
          // 6) Pullback
          pullback: metrics.pullback,
          pullbackInRange: metrics.pullbackInRange,
          // 7) Pullback low
          pullbackLow: metrics.pullbackLow,
          // 8) Bounce
          bounceOk: metrics.bounceOk,
          // 9) Regime gate
          aboveSma200: metrics.aboveSma200,
          // 10) Not extended
          notExtended: metrics.notExtended,
          // 11) Sharp drop
          noSharpDrop: metrics.noSharpDrop,
          sharpDropCount: metrics.sharpDropCount,
          worstDrop: metrics.worstDrop,
        };

        if (existing) {
          // Update existing opportunity with new metrics
          existing.currentPrice = metrics.close;
          existing.factors = factors;
          await this.opportunityRepo.save(existing);
          opportunities.push(existing);
          continue;
        }

        // Get company name and logo
        let companyName: string | undefined;
        let logoUrl: string | undefined;
        try {
          const tickerDetails = await this.polygonService.getTickerDetails(result.symbol);
          companyName = tickerDetails?.name;
          // Polygon logo URLs need the API key appended
          if (tickerDetails?.logo_url) {
            logoUrl = `${tickerDetails.logo_url}?apiKey=${process.env.POLYGON_API_KEY}`;
          } else if (tickerDetails?.icon_url) {
            logoUrl = `${tickerDetails.icon_url}?apiKey=${process.env.POLYGON_API_KEY}`;
          }
        } catch {
          // Ignore errors fetching company name
        }

        // Get AI analysis
        let aiAnalysis: { summary: string; bullCase: string; bearCase: string; confidence: number; recommendation: string; suggestedTrailPercent: number } | null = null;
        if (this.aiService.isConfigured()) {
          try {
            const news = await this.polygonService.getNews(result.symbol, 5);
            const indicators = await this.polygonService.getTechnicalIndicators(result.symbol);

            aiAnalysis = await this.aiService.getTradeReasoning({
              symbol: result.symbol,
              currentPrice: metrics.close,
              score: 100,
              factors: {
                pullback: metrics.pullback * 100,
                extPct: metrics.extPct * 100,
                adv45M: metrics.adv45 / 1_000_000,
              },
              indicators: indicators as unknown as Record<string, number>,
              newsHeadlines: news.map((n) => n.title),
            });
          } catch (error) {
            this.logger.warn(`AI analysis failed for ${result.symbol}: ${(error as Error).message}`);
          }
        }

        // Calculate score based on pullback quality (5-8% is ideal range)
        const pullbackPct = metrics.pullback * 100;
        let score = 50; // Base score
        if (metrics.pullbackInRange) score += 20;
        if (metrics.bounceOk) score += 15;
        if (metrics.aboveSma200) score += 10;
        if (metrics.notExtended) score += 5;
        if (metrics.trendState === 'Uptrend') score += 10;

        // Calculate suggested trail percent
        const suggestedTrailPercent = Math.max(5, Math.min(12, pullbackPct * 1.5));

        const opportunity = this.opportunityRepo.create({
          symbol: result.symbol,
          companyName,
          logoUrl,
          score: Math.min(100, score),
          factors,
          currentPrice: metrics.close,
          aiAnalysis: aiAnalysis?.summary,
          bullCase: aiAnalysis?.bullCase,
          bearCase: aiAnalysis?.bearCase,
          aiConfidence: aiAnalysis?.confidence,
          aiRecommendation: aiAnalysis?.recommendation,
          suggestedEntry: metrics.close,
          suggestedTrailPercent: aiAnalysis?.suggestedTrailPercent || suggestedTrailPercent,
          status: OpportunityStatus.PENDING,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
        });

        await this.opportunityRepo.save(opportunity);
        opportunities.push(opportunity);

        this.eventEmitter.emit('opportunity.created', opportunity);
      }

      this.logger.log(`Scan complete: ${opportunities.length} opportunities found`);
      return opportunities;
    } finally {
      this.isScanning = false;
      this.scanStartTime = null;
    }
  }

  async manualScan(symbols?: string[], asOfDate?: string): Promise<Opportunity[]> {
    if (symbols && symbols.length > 0) {
      // Add to watchlist temporarily
      for (const symbol of symbols) {
        const existing = await this.watchlistRepo.findOne({
          where: { symbol: symbol.toUpperCase() },
        });
        if (!existing) {
          await this.watchlistRepo.save({
            symbol: symbol.toUpperCase(),
            active: true,
            fromScreener: true,
          });
        }
      }
    }

    return this.scanWatchlist(asOfDate);
  }

  async getActiveOpportunities(): Promise<Opportunity[]> {
    return this.opportunityRepo.find({
      where: {
        status: In([OpportunityStatus.PENDING, OpportunityStatus.APPROVED]),
        expiresAt: MoreThan(new Date()),
      },
      order: { score: 'DESC' },
    });
  }

  async getOpportunityById(id: string): Promise<Opportunity | null> {
    return this.opportunityRepo.findOne({ where: { id } });
  }

  async approveOpportunity(id: string): Promise<Opportunity | null> {
    const opportunity = await this.opportunityRepo.findOne({ where: { id } });
    if (!opportunity) return null;

    opportunity.status = OpportunityStatus.APPROVED;
    await this.opportunityRepo.save(opportunity);

    this.eventEmitter.emit('opportunity.approved', opportunity);
    return opportunity;
  }

  async rejectOpportunity(id: string): Promise<Opportunity | null> {
    const opportunity = await this.opportunityRepo.findOne({ where: { id } });
    if (!opportunity) return null;

    opportunity.status = OpportunityStatus.REJECTED;
    await this.opportunityRepo.save(opportunity);

    return opportunity;
  }

  // Get qualification results for debugging/display
  async getQualificationResults(symbols?: string[]): Promise<QualificationResult[]> {
    if (!symbols || symbols.length === 0) {
      const watchlist = await this.watchlistRepo.find({ where: { active: true } });
      symbols = watchlist.map(w => w.symbol);
    }
    return this.buyQualificationService.qualifyMultiple(symbols);
  }

  // Clear all pending opportunities
  async clearPendingOpportunities(): Promise<number> {
    const result = await this.opportunityRepo.delete({
      status: OpportunityStatus.PENDING,
    });
    this.logger.log(`Cleared ${result.affected} pending opportunities`);
    return result.affected || 0;
  }

  // Remove duplicate opportunities (keep newest)
  async removeDuplicates(): Promise<number> {
    // Get all active opportunities grouped by symbol
    const opportunities = await this.opportunityRepo.find({
      where: {
        status: In([OpportunityStatus.PENDING, OpportunityStatus.APPROVED]),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    // Group by symbol
    const bySymbol = new Map<string, typeof opportunities>();
    for (const opp of opportunities) {
      const existing = bySymbol.get(opp.symbol) || [];
      existing.push(opp);
      bySymbol.set(opp.symbol, existing);
    }

    // Delete duplicates (keep the first/newest one)
    let deleted = 0;
    for (const [symbol, opps] of bySymbol) {
      if (opps.length > 1) {
        // Keep the first one (newest due to DESC order), delete the rest
        const toDelete = opps.slice(1).map(o => o.id);
        if (toDelete.length > 0) {
          await this.opportunityRepo.delete(toDelete);
          deleted += toDelete.length;
          this.logger.log(`Removed ${toDelete.length} duplicate(s) for ${symbol}`);
        }
      }
    }

    return deleted;
  }
}
