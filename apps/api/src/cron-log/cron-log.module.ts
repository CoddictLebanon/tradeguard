import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronLog } from '../entities/cron-log.entity';
import { CronLogService } from './cron-log.service';
import { CronLogController } from './cron-log.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CronLog])],
  controllers: [CronLogController],
  providers: [CronLogService],
  exports: [CronLogService],
})
export class CronLogModule {}
