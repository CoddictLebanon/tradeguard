import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';

@Controller('telegram')
@UseGuards(JwtAuthGuard)
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Get('config')
  async getConfig() {
    const config = await this.telegramService.getConfig();
    // Don't expose the bot token in full
    return {
      enabled: config.enabled,
      botToken: config.botToken ? '***configured***' : null,
      chatId: config.chatId,
      notifyOpened: config.notifyOpened,
      notifyStopRaised: config.notifyStopRaised,
      notifyClosed: config.notifyClosed,
    };
  }

  @Post('config')
  async updateConfig(
    @Body() body: {
      enabled?: boolean;
      botToken?: string;
      chatId?: string;
      notifyOpened?: boolean;
      notifyStopRaised?: boolean;
      notifyClosed?: boolean;
    },
  ) {
    await this.telegramService.updateConfig(body);
    return { success: true };
  }

  @Post('test')
  async sendTestMessage() {
    return this.telegramService.sendTestMessage();
  }
}
