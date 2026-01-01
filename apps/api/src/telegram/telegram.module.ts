import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { Setting } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramNotifierService],
  exports: [TelegramService],
})
export class TelegramModule {}
