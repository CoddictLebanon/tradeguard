import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { ScoringService } from './scoring.service';

@Module({
  imports: [DataModule],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class StrategyModule {}
