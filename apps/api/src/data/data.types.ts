export interface StockQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

export interface StockBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: Date;
  symbols: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface TechnicalIndicators {
  sma20: number;
  sma50: number;
  rsi: number;
  atr: number;
  volume20Avg: number;
  volumeRatio: number;
}

export interface ExtendedTechnicalIndicators extends TechnicalIndicators {
  sma200: number;
  sma200Slope: number;        // Positive = rising
  priceVsSma200Percent: number;
  priceVsSma20Percent: number;
  priceVsSma50Percent: number;
  atrPercent: number;         // ATR as % of current price
}
