import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthLog } from './entities/health-log.entity';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { ReconciliationService } from './reconciliation.service';
import { Position } from '../entities/position.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { IBModule } from '../ib/ib.module';
import { DataModule } from '../data/data.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HealthLog, Position, ActivityLog]),
    IBModule,
    DataModule,
    TelegramModule,
  ],
  controllers: [HealthController],
  providers: [HealthService, ReconciliationService],
  exports: [HealthService, ReconciliationService],
})
export class HealthModule implements OnModuleInit {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  onModuleInit() {
    // Run reconciliation on startup
    this.reconciliationService.runOnStartup();
  }
}
