import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { NEWS_ANALYSIS_PROMPT, TRADE_REASONING_PROMPT, RISK_ASSESSMENT_PROMPT } from './prompts';

export interface NewsAnalysis {
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  keyFacts: string[];
  riskFlags: string[];
  priceImpact: 'high' | 'medium' | 'low';
}

export interface TradeReasoning {
  recommendation: 'BUY' | 'HOLD' | 'AVOID';
  summary: string;
  bullCase: string;
  bearCase: string;
  confidence: number;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  warnings: string[];
}

export interface RiskAssessment {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reason: string;
  concerns: string[];
  sectorWarning: boolean;
  correlationWarning: boolean;
  suggestedAdjustments: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private client: Anthropic | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY', '');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not configured - AI features disabled');
    }
  }

  private async chat(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('AI service not configured');
    }

    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  private parseJSON<T>(response: string): T {
    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  async analyzeNews(symbol: string, article: string): Promise<NewsAnalysis> {
    const prompt = NEWS_ANALYSIS_PROMPT
      .replace('{symbol}', symbol)
      .replace('{article}', article);

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<NewsAnalysis>(response);
    } catch (error) {
      this.logger.error(`News analysis failed: ${(error as Error).message}`);
      return {
        summary: 'Analysis unavailable',
        sentiment: 'neutral',
        keyFacts: [],
        riskFlags: [],
        priceImpact: 'low',
      };
    }
  }

  async getTradeReasoning(params: {
    symbol: string;
    currentPrice: number;
    score: number;
    factors: Record<string, number>;
    indicators: Record<string, number>;
    newsHeadlines: string[];
  }): Promise<TradeReasoning> {
    const prompt = TRADE_REASONING_PROMPT
      .replace('{symbol}', params.symbol)
      .replace('{currentPrice}', params.currentPrice.toString())
      .replace('{score}', params.score.toString())
      .replace('{volumeSurge}', params.factors.volumeSurge?.toString() || '0')
      .replace('{technicalBreakout}', params.factors.technicalBreakout?.toString() || '0')
      .replace('{sectorMomentum}', params.factors.sectorMomentum?.toString() || '0')
      .replace('{newsSentiment}', params.factors.newsSentiment?.toString() || '0')
      .replace('{volatilityFit}', params.factors.volatilityFit?.toString() || '0')
      .replace('{sma20}', params.indicators.sma20?.toFixed(2) || 'N/A')
      .replace('{sma50}', params.indicators.sma50?.toFixed(2) || 'N/A')
      .replace('{rsi}', params.indicators.rsi?.toFixed(1) || 'N/A')
      .replace('{atr}', params.indicators.atr?.toFixed(2) || 'N/A')
      .replace('{newsHeadlines}', params.newsHeadlines.join('\n') || 'No recent news');

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<TradeReasoning>(response);
    } catch (error) {
      this.logger.error(`Trade reasoning failed: ${(error as Error).message}`);
      return {
        recommendation: 'HOLD',
        summary: 'AI analysis unavailable',
        bullCase: 'Unable to analyze',
        bearCase: 'Unable to analyze',
        confidence: 50,
        suggestedEntry: params.currentPrice,
        suggestedTrailPercent: 10,
        warnings: ['AI analysis failed'],
      };
    }
  }

  async assessRisk(params: {
    symbol: string;
    positionSize: number;
    positionPercent: number;
    entry: number;
    trailPercent: number;
    portfolioValue: number;
    cashAvailable: number;
    currentPositions: string;
    sectorExposure: string;
    vix?: number;
    marketTrend?: string;
    upcomingEvents?: string;
  }): Promise<RiskAssessment> {
    const prompt = RISK_ASSESSMENT_PROMPT
      .replace('{symbol}', params.symbol)
      .replace('{positionSize}', params.positionSize.toString())
      .replace('{positionPercent}', params.positionPercent.toString())
      .replace('{entry}', params.entry.toString())
      .replace('{trailPercent}', params.trailPercent.toString())
      .replace('{portfolioValue}', params.portfolioValue.toString())
      .replace('{cashAvailable}', params.cashAvailable.toString())
      .replace('{currentPositions}', params.currentPositions || 'None')
      .replace('{sectorExposure}', params.sectorExposure || 'None')
      .replace('{vix}', params.vix?.toString() || 'Unknown')
      .replace('{marketTrend}', params.marketTrend || 'Unknown')
      .replace('{upcomingEvents}', params.upcomingEvents || 'None known');

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<RiskAssessment>(response);
    } catch (error) {
      this.logger.error(`Risk assessment failed: ${(error as Error).message}`);
      return {
        recommendation: 'CAUTION',
        reason: 'AI risk assessment unavailable',
        concerns: ['Unable to perform AI analysis'],
        sectorWarning: false,
        correlationWarning: false,
        suggestedAdjustments: 'Proceed with caution',
      };
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}
