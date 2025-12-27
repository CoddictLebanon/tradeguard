import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity, OpportunityStatus } from '../entities/opportunity.entity';
import { ScoringService } from '../strategy/scoring.service';
import { AIService } from '../ai/ai.service';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private isScanning = false;
  private scoreThreshold = 50;

  constructor(
    @InjectRepository(WatchlistItem)
    private watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(Opportunity)
    private opportunityRepo: Repository<Opportunity>,
    private readonly scoringService: ScoringService,
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

  async scanWatchlist(): Promise<Opportunity[]> {
    if (this.isScanning) {
      this.logger.warn('Scan already in progress, skipping');
      return [];
    }

    this.isScanning = true;
    this.logger.log('Starting watchlist scan');

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
      this.logger.log(`Scanning ${symbols.length} symbols`);

      // Score all stocks
      const scores = await this.scoringService.scoreMultiple(symbols);

      // Filter by threshold and create opportunities
      const opportunities: Opportunity[] = [];

      for (const score of scores) {
        if (score.totalScore < this.scoreThreshold) continue;

        // Check if we already have a pending opportunity for this symbol
        const existing = await this.opportunityRepo.findOne({
          where: {
            symbol: score.symbol,
            status: OpportunityStatus.PENDING,
            expiresAt: MoreThan(new Date()),
          },
        });

        if (existing) {
          // Update existing opportunity
          existing.score = score.totalScore;
          existing.factors = score.factors;
          existing.currentPrice = score.currentPrice;
          await this.opportunityRepo.save(existing);
          opportunities.push(existing);
          continue;
        }

        // Get AI analysis for high-scoring opportunities
        let aiAnalysis: Awaited<ReturnType<typeof this.aiService.getTradeReasoning>> | null = null;
        if (score.totalScore >= 70 && this.aiService.isConfigured()) {
          try {
            const news = await this.polygonService.getNews(score.symbol, 5);
            const indicators = await this.polygonService.getTechnicalIndicators(score.symbol);

            aiAnalysis = await this.aiService.getTradeReasoning({
              symbol: score.symbol,
              currentPrice: score.currentPrice,
              score: score.totalScore,
              factors: score.factors as unknown as Record<string, number>,
              indicators: indicators as unknown as Record<string, number>,
              newsHeadlines: news.map((n) => n.title),
            });
          } catch (error) {
            this.logger.warn(`AI analysis failed for ${score.symbol}: ${(error as Error).message}`);
          }
        }

        // Create new opportunity
        const opportunity = this.opportunityRepo.create({
          symbol: score.symbol,
          score: score.totalScore,
          factors: score.factors,
          currentPrice: score.currentPrice,
          aiAnalysis: aiAnalysis?.summary,
          bullCase: aiAnalysis?.bullCase,
          bearCase: aiAnalysis?.bearCase,
          aiConfidence: aiAnalysis?.confidence,
          suggestedEntry: aiAnalysis?.suggestedEntry || score.suggestedEntry,
          suggestedTrailPercent: aiAnalysis?.suggestedTrailPercent || score.suggestedTrailPercent,
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
    }
  }

  async manualScan(symbols?: string[]): Promise<Opportunity[]> {
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

    return this.scanWatchlist();
  }

  setThreshold(threshold: number): void {
    this.scoreThreshold = Math.max(0, Math.min(100, threshold));
    this.logger.log(`Score threshold set to ${this.scoreThreshold}`);
  }

  getThreshold(): number {
    return this.scoreThreshold;
  }

  async getActiveOpportunities(): Promise<Opportunity[]> {
    return this.opportunityRepo.find({
      where: {
        status: OpportunityStatus.PENDING,
        expiresAt: MoreThan(new Date()),
      },
      order: { score: 'DESC' },
    });
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
}
