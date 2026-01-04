// apps/api/src/events/earnings-calendar.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { FinnhubService } from '../data/finnhub.service';

interface EarningsEvent {
  symbol: string;
  date: Date;
  timing: 'BMO' | 'AMC' | 'UNKNOWN'; // Before Market Open / After Market Close
}

@Injectable()
export class EarningsCalendarService {
  private readonly logger = new Logger(EarningsCalendarService.name);

  constructor(private readonly finnhubService: FinnhubService) {}

  async hasEarningsWithinDays(symbol: string, days: number = 5): Promise<{
    hasEarnings: boolean;
    nextEarningsDate?: Date;
    daysUntil?: number;
  }> {
    try {
      const earnings = await this.finnhubService.getEarningsCalendar(symbol);

      if (!earnings || earnings.length === 0) {
        return { hasEarnings: false };
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      for (const event of earnings) {
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
      // Fail safe - block trades when uncertain (conservative approach)
      return { hasEarnings: true };
    }
  }
}
