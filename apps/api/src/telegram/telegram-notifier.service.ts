import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramService } from './telegram.service';
import { ActivityType } from '../entities/activity-log.entity';

interface TradeEvent {
  type: ActivityType;
  symbol: string;
  details: Record<string, any>;
}

@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(private readonly telegramService: TelegramService) {}

  @OnEvent('activity.trade')
  async handleTradeEvent(event: TradeEvent): Promise<void> {
    const config = await this.telegramService.getConfig();

    if (!config.enabled) return;

    // Check if this event type should trigger a notification
    if (event.type === ActivityType.POSITION_OPENED && !config.notifyOpened) return;
    if (event.type === ActivityType.TRAILING_STOP_UPDATED && !config.notifyStopRaised) return;
    if (event.type === ActivityType.POSITION_CLOSED && !config.notifyClosed) return;

    const message = this.formatMessage(event);
    if (message) {
      await this.telegramService.sendMessage(message);
    }
  }

  private formatMessage(event: TradeEvent): string | null {
    const { type, symbol, details } = event;

    switch (type) {
      case ActivityType.POSITION_OPENED:
        return `${symbol} opened at $${details.entryPrice?.toFixed(2)}`;

      case ActivityType.TRAILING_STOP_UPDATED:
        return `${symbol} stop raised to $${details.newStopPrice?.toFixed(2)}`;

      case ActivityType.POSITION_CLOSED:
        const pnl = details.pnl as number;
        const sign = pnl > 0 ? '+' : '';
        return `${symbol} closed ${sign}$${pnl?.toFixed(2)}`;

      default:
        return null;
    }
  }
}
