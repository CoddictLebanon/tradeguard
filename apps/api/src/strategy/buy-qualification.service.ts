import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { StockBar } from '../data/data.types';

export interface QualificationMetrics {
  // 1) Liquidity
  adv45: number; // Average daily trading volume over last 45 trading days

  // 2) 200-day Simple Moving Average
  sma200: number;

  // 3) Trend state
  sma200_20daysAgo: number;
  slope: number; // SMA200_today − SMA200_20days_ago
  trendState: 'Uptrend' | 'Flat' | 'Declining';

  // 4) Extended percentage from 200-day SMA
  close: number;
  extPct: number; // (CLOSE − SMA200) / SMA200

  // 5) Recent high
  recentHigh: number; // Highest daily CLOSE in last 63 trading days
  recentHighDate: string; // Date of RECENT_HIGH (most recent if tie)

  // 6) Pullback depth
  pullback: number; // (RECENT_HIGH − CLOSE) / RECENT_HIGH
  pullbackInRange: boolean; // TRUE if PULLBACK is within 0.05 to 0.08 inclusive

  // 7) Pullback low (support point)
  pullbackLow: number; // Lowest intraday LOW from t_high through today

  // 8) Bounce confirmation
  bounceOk: boolean; // TRUE if CLOSE ≥ PULLBACK_LOW × 1.02

  // 9) Regime gate
  aboveSma200: boolean; // TRUE if CLOSE > SMA200

  // 10) Not-extended flag
  notExtended: boolean; // TRUE if EXT_PCT < 0.20

  // 11) Sharp drop check
  noSharpDrop: boolean; // TRUE if no single day dropped > 3% in last 63 days
  sharpDropCount: number; // Count of days with > 3% drop
  worstDrop: number; // Worst single-day drop (negative value)
}

export interface QualificationResult {
  symbol: string;
  success: boolean;
  error?: string;
  metrics?: QualificationMetrics;
}

@Injectable()
export class BuyQualificationService {
  private readonly logger = new Logger(BuyQualificationService.name);

  constructor(private readonly polygonService: PolygonService) {}

  async qualifyStock(symbol: string, asOfDate?: string): Promise<QualificationResult> {
    try {
      // Need 221 trading days to calculate SMA200 and SMA200_20days_ago (extra day to exclude potentially incomplete today)
      const rawBars = asOfDate
        ? await this.polygonService.getBarsAsOf(symbol, asOfDate, 260)
        : await this.polygonService.getBars(symbol, 'day', 260);

      if (rawBars.length < 221) {
        return {
          symbol,
          success: false,
          error: `Insufficient data: ${rawBars.length} trading days (need 221+)`,
        };
      }

      // Use only complete trading days - exclude the last bar if it might be today's incomplete data
      // The last COMPLETE bar is our reference point (the "last day")
      // When asOfDate is provided, use that as the reference date instead of today
      const referenceDate = asOfDate || new Date().toISOString().split('T')[0];
      const lastBarDate = rawBars[rawBars.length - 1].timestamp.toISOString().split('T')[0];
      const bars = lastBarDate === referenceDate ? rawBars.slice(0, -1) : rawBars;

      const currentBar = bars[bars.length - 1];
      const close = currentBar.close;

      // 1) ADV45 = average daily trading volume over the last 45 trading days
      const last45Bars = bars.slice(-45);
      const adv45 = last45Bars.reduce((sum, b) => sum + b.volume, 0) / last45Bars.length;

      // 2) SMA200 = simple moving average of CLOSE prices over the last 200 trading days (ending at last complete day)
      const last200Bars = bars.slice(-200);
      const sma200 = last200Bars.reduce((sum, b) => sum + b.close, 0) / 200;

      // 3) Trend state
      // SMA200_20days_ago = SMA of closes from bar[-220] to bar[-21] (200 bars ending 20 days before last complete day)
      const barsFor20dAgoSma = bars.slice(-220, -20);
      const sma200_20daysAgo = barsFor20dAgoSma.reduce((sum, b) => sum + b.close, 0) / 200;
      const slope = sma200 - sma200_20daysAgo;

      let trendState: 'Uptrend' | 'Flat' | 'Declining';
      if (slope > 0) {
        trendState = 'Uptrend';
      } else if (Math.abs(slope) <= 0.001 * sma200) {
        trendState = 'Flat';
      } else {
        trendState = 'Declining';
      }

      // 4) EXT_PCT = (CLOSE − SMA200) / SMA200
      const extPct = (close - sma200) / sma200;

      // 5) RECENT_HIGH = highest daily CLOSE price in the last 63 trading days
      // If multiple days share the same highest close, use the most recent occurrence
      const last63Bars = bars.slice(-63);
      let recentHigh = -Infinity;
      let recentHighIndex = -1;
      for (let i = 0; i < last63Bars.length; i++) {
        if (last63Bars[i].close >= recentHigh) {
          recentHigh = last63Bars[i].close;
          recentHighIndex = i;
        }
      }
      const recentHighBar = last63Bars[recentHighIndex];
      const recentHighDate = recentHighBar.timestamp.toISOString().split('T')[0];

      // 6) PULLBACK = (RECENT_HIGH − CLOSE) / RECENT_HIGH
      const pullback = (recentHigh - close) / recentHigh;
      // Flag whether PULLBACK is within the range 0.05 to 0.08 inclusive
      const pullbackInRange = pullback >= 0.05 && pullback <= 0.08;

      // 7) PULLBACK_LOW = lowest intraday LOW price from t_high through today
      // t_high is the date of the most recent RECENT_HIGH close
      // Bars from recentHighIndex to end of last63Bars
      const barsFromHighToNow = last63Bars.slice(recentHighIndex);
      let pullbackLow = Infinity;
      for (const bar of barsFromHighToNow) {
        if (bar.low < pullbackLow) {
          pullbackLow = bar.low;
        }
      }

      // 8) BOUNCE_OK = TRUE if CLOSE ≥ PULLBACK_LOW × 1.02
      const bounceOk = close >= pullbackLow * 1.02;

      // 9) ABOVE_SMA200 = TRUE if CLOSE > SMA200
      const aboveSma200 = close > sma200;

      // 10) NOT_EXTENDED = TRUE if EXT_PCT < 0.20
      const notExtended = extPct < 0.20;

      // 11) Sharp drop check - look for any day with > 3% drop in last 63 days
      let sharpDropCount = 0;
      let worstDrop = 0;
      for (let i = 1; i < last63Bars.length; i++) {
        const prevClose = last63Bars[i - 1].close;
        const currClose = last63Bars[i].close;
        const dailyChange = (currClose - prevClose) / prevClose;
        if (dailyChange < -0.03) {
          sharpDropCount++;
        }
        if (dailyChange < worstDrop) {
          worstDrop = dailyChange;
        }
      }
      // Allow up to 2 sharp drop days, exclude if 3 or more
      const noSharpDrop = sharpDropCount < 3;

      return {
        symbol,
        success: true,
        metrics: {
          adv45,
          sma200,
          sma200_20daysAgo,
          slope,
          trendState,
          close,
          extPct,
          recentHigh,
          recentHighDate,
          pullback,
          pullbackInRange,
          pullbackLow,
          bounceOk,
          aboveSma200,
          notExtended,
          noSharpDrop,
          sharpDropCount,
          worstDrop,
        },
      };
    } catch (error) {
      return {
        symbol,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async qualifyMultiple(symbols: string[], asOfDate?: string): Promise<QualificationResult[]> {
    const results = await Promise.allSettled(
      symbols.map(symbol => this.qualifyStock(symbol, asOfDate))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<QualificationResult> => r.status === 'fulfilled')
      .map(r => r.value);
  }
}
