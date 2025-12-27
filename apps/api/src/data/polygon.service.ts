import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StockQuote, StockBar, NewsArticle, TechnicalIndicators } from './data.types';

@Injectable()
export class PolygonService {
  private readonly logger = new Logger(PolygonService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.polygon.io';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('POLYGON_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('POLYGON_API_KEY not configured');
    }
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const data = await this.fetch<any>(`/v2/aggs/ticker/${symbol}/prev`);

    if (!data.results || data.results.length === 0) {
      throw new Error(`No quote data for ${symbol}`);
    }

    const result = data.results[0];
    const previousClose = result.c;

    // Get current snapshot
    const snapshot = await this.fetch<any>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const current = snapshot.ticker;

    return {
      symbol,
      price: current?.day?.c || result.c,
      open: current?.day?.o || result.o,
      high: current?.day?.h || result.h,
      low: current?.day?.l || result.l,
      close: current?.day?.c || result.c,
      volume: current?.day?.v || result.v,
      previousClose,
      change: (current?.day?.c || result.c) - previousClose,
      changePercent: (((current?.day?.c || result.c) - previousClose) / previousClose) * 100,
      timestamp: new Date(),
    };
  }

  async getBars(
    symbol: string,
    timespan: 'minute' | 'hour' | 'day' = 'day',
    limit: number = 50,
  ): Promise<StockBar[]> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - limit * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const data = await this.fetch<any>(
      `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}`,
    );

    if (!data.results) {
      return [];
    }

    return data.results.map((bar: any) => ({
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      timestamp: new Date(bar.t),
    }));
  }

  async getNews(symbol?: string, limit: number = 20): Promise<NewsArticle[]> {
    const endpoint = symbol
      ? `/v2/reference/news?ticker=${symbol}&limit=${limit}`
      : `/v2/reference/news?limit=${limit}`;

    const data = await this.fetch<any>(endpoint);

    if (!data.results) {
      return [];
    }

    return data.results.map((article: any) => ({
      id: article.id,
      title: article.title,
      description: article.description || '',
      url: article.article_url,
      source: article.publisher?.name || 'Unknown',
      publishedAt: new Date(article.published_utc),
      symbols: article.tickers || [],
    }));
  }

  async getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
    const bars = await this.getBars(symbol, 'day', 50);

    if (bars.length < 20) {
      throw new Error(`Insufficient data for ${symbol}`);
    }

    // Calculate SMA 20
    const sma20 = bars.slice(-20).reduce((sum, bar) => sum + bar.close, 0) / 20;

    // Calculate SMA 50 (or use available data)
    const sma50 = bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length;

    // Calculate RSI (14-period)
    const rsi = this.calculateRSI(bars.slice(-15));

    // Calculate ATR (14-period)
    const atr = this.calculateATR(bars.slice(-15));

    // Volume analysis
    const volume20Avg = bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) / 20;
    const currentVolume = bars[bars.length - 1].volume;
    const volumeRatio = currentVolume / volume20Avg;

    return {
      sma20,
      sma50,
      rsi,
      atr,
      volume20Avg,
      volumeRatio,
    };
  }

  private calculateRSI(bars: StockBar[]): number {
    if (bars.length < 2) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < bars.length; i++) {
      const change = bars[i].close - bars[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / (bars.length - 1);
    const avgLoss = losses / (bars.length - 1);

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateATR(bars: StockBar[]): number {
    if (bars.length < 2) return 0;

    let trSum = 0;

    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high;
      const low = bars[i].low;
      const prevClose = bars[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trSum += tr;
    }

    return trSum / (bars.length - 1);
  }
}
