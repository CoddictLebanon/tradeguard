import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/settings.entity';

interface TelegramConfig {
  enabled: boolean;
  botToken: string | null;
  chatId: string | null;
  notifyOpened: boolean;
  notifyStopRaised: boolean;
  notifyClosed: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  async getConfig(): Promise<TelegramConfig> {
    const settings = await this.settingRepo.find({
      where: [
        { key: 'telegram_enabled' },
        { key: 'telegram_bot_token' },
        { key: 'telegram_chat_id' },
        { key: 'telegram_notify_opened' },
        { key: 'telegram_notify_stop_raised' },
        { key: 'telegram_notify_closed' },
      ],
    });

    const get = (key: string, defaultValue: any) => {
      const setting = settings.find((s) => s.key === key);
      return setting ? setting.value : defaultValue;
    };

    return {
      enabled: get('telegram_enabled', false),
      botToken: get('telegram_bot_token', null),
      chatId: get('telegram_chat_id', null),
      notifyOpened: get('telegram_notify_opened', true),
      notifyStopRaised: get('telegram_notify_stop_raised', true),
      notifyClosed: get('telegram_notify_closed', true),
    };
  }

  async updateConfig(config: Partial<TelegramConfig>): Promise<void> {
    const now = new Date();
    const updates: Array<{ key: string; value: any }> = [];

    if (config.enabled !== undefined) updates.push({ key: 'telegram_enabled', value: config.enabled });
    if (config.botToken !== undefined) updates.push({ key: 'telegram_bot_token', value: config.botToken });
    if (config.chatId !== undefined) updates.push({ key: 'telegram_chat_id', value: config.chatId });
    if (config.notifyOpened !== undefined) updates.push({ key: 'telegram_notify_opened', value: config.notifyOpened });
    if (config.notifyStopRaised !== undefined) updates.push({ key: 'telegram_notify_stop_raised', value: config.notifyStopRaised });
    if (config.notifyClosed !== undefined) updates.push({ key: 'telegram_notify_closed', value: config.notifyClosed });

    for (const { key, value } of updates) {
      await this.settingRepo.upsert({ key, value, updatedAt: now }, ['key']);
    }
  }

  async sendMessage(text: string): Promise<boolean> {
    const config = await this.getConfig();

    if (!config.enabled || !config.botToken || !config.chatId) {
      this.logger.debug('Telegram not configured, skipping message');
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Telegram API error: ${error}`);
        return false;
      }

      this.logger.log(`Telegram message sent: ${text}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send Telegram message: ${err}`);
      return false;
    }
  }

  async sendTestMessage(): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig();

    if (!config.botToken || !config.chatId) {
      return { success: false, error: 'Bot token and chat ID are required' };
    }

    try {
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: 'TradeGuard connected successfully!',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.description || 'Failed to send message' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
