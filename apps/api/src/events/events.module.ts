// apps/api/src/events/events.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EarningsCalendarService } from './earnings-calendar.service';

@Module({
  imports: [ConfigModule],
  providers: [EarningsCalendarService],
  exports: [EarningsCalendarService],
})
export class EventsModule {}
