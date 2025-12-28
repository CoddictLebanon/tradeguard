import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScoringService } from './scoring.service';
import { TradeSetupService } from './trade-setup.service';
import { TradeQualificationService } from './trade-qualification.service';
import { TradeExecutionService } from './trade-execution.service';
import { BuyQualificationService } from './buy-qualification.service';
import { DataModule } from '../data/data.module';
import { TradeUniverseModule } from '../universe/trade-universe.module';
import { EventsModule } from '../events/events.module';
import { RiskModule } from '../risk/risk.module';
import { SafetyModule } from '../safety/safety.module';
import { IBModule } from '../ib/ib.module';
import { Position } from '../entities/position.entity';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, ActivityLog]),
    DataModule,
    TradeUniverseModule,
    EventsModule,
    RiskModule,
    SafetyModule,
    IBModule,
  ],
  providers: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
    TradeExecutionService,
    BuyQualificationService,
  ],
  exports: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
    TradeExecutionService,
    BuyQualificationService,
  ],
})
export class StrategyModule {}
