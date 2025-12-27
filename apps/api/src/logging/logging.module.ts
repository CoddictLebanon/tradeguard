// apps/api/src/logging/logging.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeLoggingService } from './trade-logging.service';
import { TradeLog } from '../entities/trade-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TradeLog])],
  providers: [TradeLoggingService],
  exports: [TradeLoggingService],
})
export class LoggingModule {}
