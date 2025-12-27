// apps/api/src/events/earnings-calendar.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EarningsEvent {
  symbol: string;
  date: Date;
  timing: 'BMO' | 'AMC' | 'UNKNOWN'; // Before Market Open / After Market Close
}

@Injectable()
export class EarningsCalendarService {
  private readonly logger = new Logger(EarningsCalendarService.name);
  private readonly finnhubKey: string;
  private readonly baseUrl = 'https://finnhub.io/api/v1';

  constructor(private readonly configService: ConfigService) {
    this.finnhubKey = this.configService.get<string>('FINNHUB_API_KEY', '');
  }

  async hasEarningsWithinDays(symbol: string, days: number = 5): Promise<{
    hasEarnings: boolean;
    nextEarningsDate?: Date;
    daysUntil?: number;
  }> {
    if (!this.finnhubKey) {
      this.logger.warn('FINNHUB_API_KEY not configured, skipping earnings check');
      return { hasEarnings: false };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/calendar/earnings?symbol=${symbol}&token=${this.finnhubKey}`
      );

      if (!response.ok) {
        throw new Error(`Finnhub API error: ${response.status}`);
      }

      const data = await response.json() as { earningsCalendar?: Array<{ date: string }> };

      if (!data.earningsCalendar || data.earningsCalendar.length === 0) {
        return { hasEarnings: false };
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      for (const event of data.earningsCalendar) {
        const earningsDate = new Date(event.date);
        earningsDate.setHours(0, 0, 0, 0);

        const diffTime = earningsDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
          return {
            hasEarnings: true,
            nextEarningsDate: earningsDate,
            daysUntil: diffDays,
          };
        }
      }

      return { hasEarnings: false };
    } catch (error) {
      this.logger.error(`Failed to check earnings for ${symbol}: ${(error as Error).message}`);
      // Fail safe - if we can't check, assume there might be earnings
      return { hasEarnings: false };
    }
  }
}
