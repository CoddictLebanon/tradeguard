import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScannerService } from './scanner.service';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity } from '../entities/opportunity.entity';
import { StrategyModule } from '../strategy/strategy.module';
import { AIModule } from '../ai/ai.module';
import { DataModule } from '../data/data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, Opportunity]),
    StrategyModule,
    AIModule,
    DataModule,
  ],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
