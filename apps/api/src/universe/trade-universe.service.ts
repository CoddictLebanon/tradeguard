// apps/api/src/universe/trade-universe.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import {
  SP500_SYMBOLS,
  NASDAQ100_SYMBOLS,
  LIQUID_ETFS,
  EXCLUDED_SYMBOLS,
  MIN_AVG_DAILY_VOLUME,
} from './universe-data';

export interface UniverseCheckResult {
  inUniverse: boolean;
  reason?: string;
  avgDailyVolume?: number;
  isSP500: boolean;
  isNasdaq100: boolean;
  isETF: boolean;
}

@Injectable()
export class TradeUniverseService {
  private readonly logger = new Logger(TradeUniverseService.name);
  private readonly allValidSymbols: Set<string>;

  constructor(private readonly polygonService: PolygonService) {
    // Combine all valid symbols into a set (deduplicated)
    this.allValidSymbols = new Set([
      ...SP500_SYMBOLS,
      ...NASDAQ100_SYMBOLS,
      ...LIQUID_ETFS,
    ]);

    // Remove excluded symbols
    EXCLUDED_SYMBOLS.forEach(s => this.allValidSymbols.delete(s));
  }

  async checkSymbol(symbol: string): Promise<UniverseCheckResult> {
    const upperSymbol = symbol.toUpperCase();

    // Check if explicitly excluded
    if (EXCLUDED_SYMBOLS.includes(upperSymbol)) {
      return {
        inUniverse: false,
        reason: 'Symbol is on exclusion list (meme stock or illiquid)',
        isSP500: false,
        isNasdaq100: false,
        isETF: false,
      };
    }

    // Check if in valid universe
    const isSP500 = SP500_SYMBOLS.includes(upperSymbol);
    const isNasdaq100 = NASDAQ100_SYMBOLS.includes(upperSymbol);
    const isETF = LIQUID_ETFS.includes(upperSymbol);

    if (!isSP500 && !isNasdaq100 && !isETF) {
      return {
        inUniverse: false,
        reason: 'Symbol not in S&P 500, Nasdaq 100, or approved ETF list',
        isSP500,
        isNasdaq100,
        isETF,
      };
    }

    // Check volume requirement
    try {
      const indicators = await this.polygonService.getTechnicalIndicators(upperSymbol);
      const avgDailyVolume = indicators.volume20Avg;

      if (avgDailyVolume < MIN_AVG_DAILY_VOLUME) {
        return {
          inUniverse: false,
          reason: `Average daily volume ${avgDailyVolume.toLocaleString()} below minimum ${MIN_AVG_DAILY_VOLUME.toLocaleString()}`,
          avgDailyVolume,
          isSP500,
          isNasdaq100,
          isETF,
        };
      }

      return {
        inUniverse: true,
        avgDailyVolume,
        isSP500,
        isNasdaq100,
        isETF,
      };
    } catch (error) {
      this.logger.warn(`Failed to check volume for ${upperSymbol}: ${(error as Error).message}`);
      return {
        inUniverse: false,
        reason: 'Failed to verify volume data',
        isSP500,
        isNasdaq100,
        isETF,
      };
    }
  }

  getAllValidSymbols(): string[] {
    return Array.from(this.allValidSymbols);
  }

  getSP500Symbols(): string[] {
    return [...SP500_SYMBOLS];
  }

  getNasdaq100Symbols(): string[] {
    return [...NASDAQ100_SYMBOLS];
  }

  getETFSymbols(): string[] {
    return [...LIQUID_ETFS];
  }
}
