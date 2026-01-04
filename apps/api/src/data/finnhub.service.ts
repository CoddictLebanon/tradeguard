import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NewsArticle } from './data.types';

@Injectable()
export class FinnhubService {
  private readonly logger = new Logger(FinnhubService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://finnhub.io/api/v1';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FINNHUB_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('FINNHUB_API_KEY not configured');
    }
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getCompanyNews(symbol: string, daysBack: number = 7): Promise<NewsArticle[]> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const data = await this.fetch<any[]>(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);

    return data.slice(0, 20).map((article) => ({
      id: article.id?.toString() || article.url,
      title: article.headline,
      description: article.summary || '',
      url: article.url,
      source: article.source,
      publishedAt: new Date(article.datetime * 1000),
      symbols: [symbol],
    }));
  }

  async getNewsSentiment(symbol: string): Promise<{ score: number; buzz: number }> {
    const data = await this.fetch<any>(`/news-sentiment?symbol=${symbol}`);

    return {
      score: data.sentiment?.bullishPercent || 0.5,
      buzz: data.buzz?.articlesInLastWeek || 0,
    };
  }

  async getMarketNews(category: 'general' | 'forex' | 'crypto' | 'merger' = 'general'): Promise<NewsArticle[]> {
    const data = await this.fetch<any[]>(`/news?category=${category}`);

    return data.slice(0, 20).map((article) => ({
      id: article.id?.toString() || article.url,
      title: article.headline,
      description: article.summary || '',
      url: article.url,
      source: article.source,
      publishedAt: new Date(article.datetime * 1000),
      symbols: article.related?.split(',') || [],
    }));
  }

  async getEarningsCalendar(symbol: string): Promise<Array<{ date: string }>> {
    if (!this.apiKey) {
      this.logger.warn('FINNHUB_API_KEY not configured');
      return [];
    }

    const data = await this.fetch<{ earningsCalendar?: Array<{ date: string }> }>(
      `/calendar/earnings?symbol=${symbol}`
    );

    return data?.earningsCalendar || [];
  }
}
