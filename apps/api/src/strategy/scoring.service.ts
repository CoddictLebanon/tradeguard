import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { StockQuote, TechnicalIndicators } from '../data/data.types';
import {
  ScoringWeights,
  ScoringFactors,
  OpportunityScore,
  DEFAULT_WEIGHTS,
} from './strategy.types';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private weights: ScoringWeights = DEFAULT_WEIGHTS;

  constructor(private readonly polygonService: PolygonService) {}

  setWeights(weights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  async scoreStock(symbol: string): Promise<OpportunityScore> {
    try {
      const [quote, indicators] = await Promise.all([
        this.polygonService.getQuote(symbol),
        this.polygonService.getTechnicalIndicators(symbol),
      ]);

      const factors = this.calculateFactors(quote, indicators);
      const totalScore = this.calculateTotalScore(factors);

      // Calculate suggested trail percent based on ATR
      const atrPercent = (indicators.atr / quote.price) * 100;
      const suggestedTrailPercent = Math.max(5, Math.min(15, atrPercent * 2));

      return {
        symbol,
        totalScore,
        factors,
        currentPrice: quote.price,
        suggestedEntry: quote.price,
        suggestedTrailPercent: Math.round(suggestedTrailPercent * 10) / 10,
        confidence: this.calculateConfidence(factors, indicators),
      };
    } catch (error) {
      this.logger.error(`Failed to score ${symbol}: ${(error as Error).message}`);
      throw error;
    }
  }

  private calculateFactors(
    quote: StockQuote,
    indicators: TechnicalIndicators,
  ): ScoringFactors {
    // Volume Surge (0-100)
    let volumeSurge = 0;
    if (indicators.volumeRatio >= 3) {
      volumeSurge = 100;
    } else if (indicators.volumeRatio >= 2) {
      volumeSurge = 60 + (indicators.volumeRatio - 2) * 40;
    } else if (indicators.volumeRatio >= 1.5) {
      volumeSurge = 30 + (indicators.volumeRatio - 1.5) * 60;
    } else {
      volumeSurge = indicators.volumeRatio * 20;
    }

    // Technical Breakout (0-100)
    let technicalBreakout = 0;
    const priceVsSma20 = (quote.price - indicators.sma20) / indicators.sma20;
    const priceVsSma50 = (quote.price - indicators.sma50) / indicators.sma50;

    if (priceVsSma20 > 0) technicalBreakout += 40;
    if (priceVsSma50 > 0) technicalBreakout += 30;
    if (indicators.rsi > 50 && indicators.rsi < 70) technicalBreakout += 30;
    else if (indicators.rsi >= 70) technicalBreakout += 10; // Overbought warning

    // Sector Momentum (0-100) - based on daily price change
    const sectorMomentum = quote.changePercent > 0
      ? Math.min(100, quote.changePercent * 20 + 50)
      : Math.max(0, 50 + quote.changePercent * 10);

    // Volatility Fit (0-100)
    // Sweet spot: ATR between 2-5% of price
    const atrPercent = (indicators.atr / quote.price) * 100;
    let volatilityFit = 0;
    if (atrPercent >= 2 && atrPercent <= 5) {
      volatilityFit = 100;
    } else if (atrPercent < 2) {
      volatilityFit = atrPercent * 50;
    } else if (atrPercent <= 8) {
      volatilityFit = 100 - (atrPercent - 5) * 20;
    } else {
      volatilityFit = Math.max(0, 40 - (atrPercent - 8) * 10);
    }

    return {
      volumeSurge: Math.round(volumeSurge),
      technicalBreakout: Math.round(technicalBreakout),
      sectorMomentum: Math.round(sectorMomentum),
      volatilityFit: Math.round(volatilityFit),
    };
  }

  private calculateTotalScore(factors: ScoringFactors): number {
    const totalWeight = Object.values(this.weights).reduce((a, b) => a + b, 0);

    const weightedScore =
      (factors.volumeSurge * this.weights.volumeSurge +
        factors.technicalBreakout * this.weights.technicalBreakout +
        factors.sectorMomentum * this.weights.sectorMomentum +
        factors.volatilityFit * this.weights.volatilityFit) /
      totalWeight;

    return Math.round(weightedScore);
  }

  private calculateConfidence(factors: ScoringFactors, indicators: TechnicalIndicators): number {
    // Higher confidence when multiple factors align
    const factorValues = Object.values(factors);
    const aboveThreshold = factorValues.filter((v) => v >= 60).length;
    const baseConfidence = (aboveThreshold / factorValues.length) * 100;

    // Adjust for RSI extremes
    let rsiAdjustment = 0;
    if (indicators.rsi > 80 || indicators.rsi < 20) {
      rsiAdjustment = -20;
    } else if (indicators.rsi > 70 || indicators.rsi < 30) {
      rsiAdjustment = -10;
    }

    return Math.round(Math.max(0, Math.min(100, baseConfidence + rsiAdjustment)));
  }

  async scoreMultiple(symbols: string[]): Promise<OpportunityScore[]> {
    const results = await Promise.allSettled(
      symbols.map((symbol) => this.scoreStock(symbol)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<OpportunityScore> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.totalScore - a.totalScore);
  }
}
