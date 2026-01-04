// apps/api/src/events/events.module.ts

import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { EarningsCalendarService } from './earnings-calendar.service';

@Module({
  imports: [DataModule],
  providers: [EarningsCalendarService],
  exports: [EarningsCalendarService],
})
export class EventsModule {}
