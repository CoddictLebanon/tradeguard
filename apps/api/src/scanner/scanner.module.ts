import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity } from '../entities/opportunity.entity';
import { StrategyModule } from '../strategy/strategy.module';
import { AIModule } from '../ai/ai.module';
import { DataModule } from '../data/data.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, Opportunity]),
    StrategyModule,
    AIModule,
    DataModule,
    RiskModule,
  ],
  controllers: [ScannerController],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
