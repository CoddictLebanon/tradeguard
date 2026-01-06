import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StockQuote, StockBar, NewsArticle, TechnicalIndicators, ExtendedTechnicalIndicators } from './data.types';

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

  async getTickerDetails(symbol: string): Promise<{
    name: string;
    market_cap?: number;
    description?: string;
    logo_url?: string;
    icon_url?: string;
  } | null> {
    try {
      const data = await this.fetch<any>(`/v3/reference/tickers/${symbol}`);
      if (!data.results) return null;
      return {
        name: data.results.name || symbol,
        market_cap: data.results.market_cap,
        description: data.results.description,
        logo_url: data.results.branding?.logo_url,
        icon_url: data.results.branding?.icon_url,
      };
    } catch {
      return null;
    }
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    // Use the single-call snapshot endpoint which includes prevDay data
    const snapshot = await this.fetch<any>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const ticker = snapshot.ticker;

    if (!ticker) {
      throw new Error(`No quote data for ${symbol}`);
    }

    const previousClose = ticker.prevDay?.c || ticker.day?.c;
    const currentPrice = ticker.day?.c || ticker.lastTrade?.p || previousClose;

    return {
      symbol,
      price: currentPrice,
      open: ticker.day?.o || previousClose,
      high: ticker.day?.h || currentPrice,
      low: ticker.day?.l || currentPrice,
      close: currentPrice,
      volume: ticker.day?.v || 0,
      previousClose,
      change: currentPrice - previousClose,
      changePercent: previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0,
      timestamp: new Date(),
    };
  }

  // Batch fetch quotes for multiple symbols in a single API call
  async getQuotesBatch(symbols: string[]): Promise<Map<string, StockQuote>> {
    const quotes = new Map<string, StockQuote>();

    if (symbols.length === 0) return quotes;

    try {
      // Use the tickers snapshot endpoint with specific tickers
      const tickerList = symbols.join(',');
      const snapshot = await this.fetch<any>(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerList}`);

      if (snapshot.tickers) {
        for (const ticker of snapshot.tickers) {
          const symbol = ticker.ticker;
          const previousClose = ticker.prevDay?.c || ticker.day?.c;
          const currentPrice = ticker.day?.c || ticker.lastTrade?.p || previousClose;

          quotes.set(symbol, {
            symbol,
            price: currentPrice,
            open: ticker.day?.o || previousClose,
            high: ticker.day?.h || currentPrice,
            low: ticker.day?.l || currentPrice,
            close: currentPrice,
            volume: ticker.day?.v || 0,
            previousClose,
            change: currentPrice - previousClose,
            changePercent: previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0,
            timestamp: new Date(),
          });
        }
      }
    } catch (err) {
      this.logger.error(`Failed to fetch batch quotes: ${(err as Error).message}`);
    }

    return quotes;
  }

  async getBars(
    symbol: string,
    timespan: 'minute' | 'hour' | 'day' = 'day',
    limit: number = 50,
  ): Promise<StockBar[]> {
    const to = new Date().toISOString().split('T')[0];
    // For daily bars, we need to account for weekends/holidays
    // Trading days are ~252/year, so multiply by 7/5 to convert trading days to calendar days
    const calendarDays = timespan === 'day' ? Math.ceil(limit * 1.5) : limit;
    const from = new Date(Date.now() - calendarDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const data = await this.fetch<any>(
      `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=5000`,
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

  async getBarsForDateRange(
    symbol: string,
    fromDate: string,
    toDate: string,
    timespan: 'minute' | 'hour' | 'day' = 'day',
  ): Promise<StockBar[]> {
    const data = await this.fetch<any>(
      `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=5000`,
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

  async getBarsAsOf(
    symbol: string,
    asOfDate: string,
    lookbackDays: number = 220,
    timespan: 'day' = 'day',
  ): Promise<StockBar[]> {
    const toDate = asOfDate;
    const to = new Date(asOfDate);
    const calendarDays = Math.ceil(lookbackDays * 1.5); // Account for weekends
    const from = new Date(to.getTime() - calendarDays * 24 * 60 * 60 * 1000);
    const fromDate = from.toISOString().split('T')[0];

    return this.getBarsForDateRange(symbol, fromDate, toDate, timespan);
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

  async getExtendedIndicators(symbol: string): Promise<ExtendedTechnicalIndicators> {
    // Need 220 days to calculate 200-day MA slope
    const bars = await this.getBars(symbol, 'day', 220);

    if (bars.length < 220) {
      throw new Error(`Insufficient data for ${symbol}: need 220 days for slope calculation, got ${bars.length}`);
    }

    const currentPrice = bars[bars.length - 1].close;

    // Calculate SMAs
    const sma20 = this.calculateSMA(bars.slice(-20));
    const sma50 = this.calculateSMA(bars.slice(-50));
    const sma200 = this.calculateSMA(bars.slice(-200));

    // Calculate 200-day MA slope (compare current to 20 days ago)
    const sma200_20daysAgo = this.calculateSMA(bars.slice(-220, -20));
    const sma200Slope = ((sma200 - sma200_20daysAgo) / sma200_20daysAgo) * 100;

    // RSI and ATR
    const rsi = this.calculateRSI(bars.slice(-15));
    const atr = this.calculateATR(bars.slice(-15));
    const atrPercent = (atr / currentPrice) * 100;

    // Volume
    const volume20Avg = bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) / 20;
    const currentVolume = bars[bars.length - 1].volume;
    const volumeRatio = currentVolume / volume20Avg;

    // Price vs MAs
    const priceVsSma20Percent = ((currentPrice - sma20) / sma20) * 100;
    const priceVsSma50Percent = ((currentPrice - sma50) / sma50) * 100;
    const priceVsSma200Percent = ((currentPrice - sma200) / sma200) * 100;

    return {
      sma20,
      sma50,
      sma200,
      sma200Slope,
      rsi,
      atr,
      atrPercent,
      volume20Avg,
      volumeRatio,
      priceVsSma20Percent,
      priceVsSma50Percent,
      priceVsSma200Percent,
    };
  }

  private calculateSMA(bars: StockBar[]): number {
    if (bars.length === 0) return 0;
    return bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length;
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
