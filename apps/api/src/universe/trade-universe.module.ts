// apps/api/src/universe/trade-universe.module.ts

import { Module } from '@nestjs/common';
import { TradeUniverseService } from './trade-universe.service';
import { DataModule } from '../data/data.module';

@Module({
  imports: [DataModule],
  providers: [TradeUniverseService],
  exports: [TradeUniverseService],
})
export class TradeUniverseModule {}
