import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity, OpportunityStatus } from '../entities/opportunity.entity';
import { BuyQualificationService, QualificationResult } from '../strategy/buy-qualification.service';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private isScanning = false;
  private scanStartTime: number | null = null;
  private readonly SCAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
  // Cache for ticker details (company name, logo) - these rarely change
  private tickerDetailsCache = new Map<string, { name?: string; logo_url?: string; icon_url?: string; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

  constructor(
    @InjectRepository(WatchlistItem)
    private watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(Opportunity)
    private opportunityRepo: Repository<Opportunity>,
    private readonly buyQualificationService: BuyQualificationService,
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

  async scanWatchlist(asOfDate?: string): Promise<{ skipped: boolean; opportunities: Opportunity[]; scannedCount?: number; message?: string }> {
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
      return { skipped: true, opportunities: [] };
    }

    this.isScanning = true;
    this.scanStartTime = Date.now();
    const scanMode = asOfDate ? `SIMULATION mode (as of ${asOfDate})` : 'LIVE mode (current data)';
    this.logger.log(`Starting watchlist scan - ${scanMode}`);

    try {
      // Get active watchlist items
      const watchlist = await this.watchlistRepo.find({
        where: { active: true },
      });

      if (watchlist.length === 0) {
        this.logger.log('No items in watchlist');
        return { skipped: false, opportunities: [], message: 'Watchlist is empty' };
      }

      const symbols = watchlist.map((item) => item.symbol);
      this.logger.log(`Scanning ${symbols.length} symbols for buy qualification`);

      // Run buy qualification on all symbols
      const qualificationResults = await this.buyQualificationService.qualifyMultiple(symbols, asOfDate);

      // Filter to successful results with metrics
      const successfulResults = qualificationResults.filter(r => r.success && r.metrics);
      this.logger.log(`${successfulResults.length} stocks have complete metrics`);

      // Filter out stocks where stop loss distance exceeds 6%
      const MAX_STOP_DISTANCE = 0.06; // 6%
      const STOP_BUFFER = 0.007; // 0.7% buffer below pullback low
      const filteredResults = successfulResults.filter(r => {
        const metrics = r.metrics!;
        const stopPrice = metrics.pullbackLow * (1 - STOP_BUFFER);
        const stopDistance = (metrics.close - stopPrice) / metrics.close;
        if (stopDistance > MAX_STOP_DISTANCE) {
          this.logger.debug(`${r.symbol} excluded: stop distance ${(stopDistance * 100).toFixed(2)}% > ${MAX_STOP_DISTANCE * 100}%`);
          return false;
        }
        return true;
      });
      this.logger.log(`${filteredResults.length} stocks pass stop distance filter (max ${MAX_STOP_DISTANCE * 100}%)`);

      // Log some failed stocks for debugging
      const failed = qualificationResults.filter(r => !r.success).slice(0, 5);
      for (const f of failed) {
        this.logger.debug(`${f.symbol} failed: ${f.error}`);
      }

      // Clear all existing pending opportunities to get fresh results each scan
      await this.opportunityRepo.delete({ status: OpportunityStatus.PENDING });

      // Fetch ticker details - use cache when available
      const tickerDetailsMap = new Map<string, { name?: string; logo_url?: string; icon_url?: string }>();
      const now = Date.now();

      // Check cache first, collect symbols that need fetching
      const symbolsToFetch: string[] = [];
      for (const result of filteredResults) {
        const cached = this.tickerDetailsCache.get(result.symbol);
        if (cached && (now - cached.cachedAt) < this.CACHE_TTL_MS) {
          tickerDetailsMap.set(result.symbol, cached);
        } else {
          symbolsToFetch.push(result.symbol);
        }
      }

      this.logger.log(`Ticker details: ${filteredResults.length - symbolsToFetch.length} cached, ${symbolsToFetch.length} to fetch`);

      // Fetch missing ticker details in parallel batches
      const BATCH_SIZE = 20;
      for (let i = 0; i < symbolsToFetch.length; i += BATCH_SIZE) {
        const batch = symbolsToFetch.slice(i, i + BATCH_SIZE);
        const detailPromises = batch.map(async (symbol) => {
          try {
            const details = await this.polygonService.getTickerDetails(symbol);
            return { symbol, details };
          } catch {
            return { symbol, details: null };
          }
        });
        const batchResults = await Promise.all(detailPromises);
        for (const { symbol, details } of batchResults) {
          if (details) {
            // Cache the result
            this.tickerDetailsCache.set(symbol, { ...details, cachedAt: now });
            tickerDetailsMap.set(symbol, details);
          }
        }
      }

      // Create all opportunity entities
      const opportunityEntities = filteredResults.map(result => {
        const metrics = result.metrics!;

        // Store all metrics in factors as numbers/strings for JSON
        const factors: Record<string, number | string | boolean> = {
          adv45: metrics.adv45,
          sma200: metrics.sma200,
          sma200_20daysAgo: metrics.sma200_20daysAgo,
          slope: metrics.slope,
          trendState: metrics.trendState,
          extPct: metrics.extPct,
          recentHigh: metrics.recentHigh,
          recentHighDate: metrics.recentHighDate,
          pullback: metrics.pullback,
          pullbackInRange: metrics.pullbackInRange,
          pullbackLow: metrics.pullbackLow,
          bounceOk: metrics.bounceOk,
          aboveSma200: metrics.aboveSma200,
          notExtended: metrics.notExtended,
          noSharpDrop: metrics.noSharpDrop,
          sharpDropCount: metrics.sharpDropCount,
          worstDrop: metrics.worstDrop,
        };

        // Get company name and logo from pre-fetched map
        const tickerDetails = tickerDetailsMap.get(result.symbol);
        let companyName: string | undefined;
        let logoUrl: string | undefined;
        if (tickerDetails) {
          companyName = tickerDetails.name;
          if (tickerDetails.logo_url) {
            logoUrl = `${tickerDetails.logo_url}?apiKey=${process.env.POLYGON_API_KEY}`;
          } else if (tickerDetails.icon_url) {
            logoUrl = `${tickerDetails.icon_url}?apiKey=${process.env.POLYGON_API_KEY}`;
          }
        }

        // Calculate score
        const pullbackPct = metrics.pullback * 100;
        let score = 50;
        if (metrics.pullbackInRange) score += 20;
        if (metrics.bounceOk) score += 15;
        if (metrics.aboveSma200) score += 10;
        if (metrics.notExtended) score += 5;
        if (metrics.trendState === 'Uptrend') score += 10;

        const suggestedTrailPercent = Math.max(5, Math.min(12, pullbackPct * 1.5));

        return this.opportunityRepo.create({
          symbol: result.symbol,
          companyName,
          logoUrl,
          score: Math.min(100, score),
          factors,
          currentPrice: metrics.close,
          suggestedEntry: metrics.close,
          suggestedTrailPercent,
          status: OpportunityStatus.PENDING,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        } as Partial<Opportunity>);
      });

      // Batch save all opportunities at once
      const opportunities = await this.opportunityRepo.save(opportunityEntities);

      // Emit events
      for (const opportunity of opportunities) {
        this.eventEmitter.emit('opportunity.created', opportunity);
      }

      this.logger.log(`Scan complete: ${opportunities.length} opportunities found`);
      return { skipped: false, opportunities, scannedCount: symbols.length };
    } finally {
      this.isScanning = false;
      this.scanStartTime = null;
    }
  }

  async manualScan(symbols?: string[], asOfDate?: string): Promise<{ skipped: boolean; opportunities: Opportunity[]; scannedCount?: number; message?: string }> {
    // If simulation mode (asOfDate provided), clear existing pending opportunities
    // since they were scanned with different (current) data
    if (asOfDate) {
      this.logger.log(`Simulation scan requested for date: ${asOfDate}`);
      await this.clearPendingOpportunities();
      // Also force reset isScanning in case it's stuck
      this.isScanning = false;
      this.scanStartTime = null;
    }

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
  async getQualificationResults(symbols?: string[], asOfDate?: string): Promise<QualificationResult[]> {
    if (!symbols || symbols.length === 0) {
      const watchlist = await this.watchlistRepo.find({ where: { active: true } });
      symbols = watchlist.map(w => w.symbol);
    }
    return this.buyQualificationService.qualifyMultiple(symbols, asOfDate);
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
