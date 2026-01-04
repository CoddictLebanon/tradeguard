import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';
import { UpdateTelegramConfigDto } from './dto/telegram.dto';

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
  async updateConfig(@Body() dto: UpdateTelegramConfigDto) {
    await this.telegramService.updateConfig(dto);
    return { success: true };
  }

  @Post('test')
  async sendTestMessage() {
    return this.telegramService.sendTestMessage();
  }
}
