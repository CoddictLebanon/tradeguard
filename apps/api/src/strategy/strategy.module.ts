import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { TradeSetupService } from './trade-setup.service';
import { TradeQualificationService } from './trade-qualification.service';
import { DataModule } from '../data/data.module';
import { TradeUniverseModule } from '../universe/trade-universe.module';
import { EventsModule } from '../events/events.module';
import { RiskModule } from '../risk/risk.module';
import { SafetyModule } from '../safety/safety.module';

@Module({
  imports: [
    DataModule,
    TradeUniverseModule,
    EventsModule,
    RiskModule,
    SafetyModule,
  ],
  providers: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
  ],
  exports: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
  ],
})
export class StrategyModule {}
