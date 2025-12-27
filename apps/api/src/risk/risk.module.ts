// apps/api/src/risk/risk.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionSizingService } from './position-sizing.service';
import { Setting } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [PositionSizingService],
  exports: [PositionSizingService],
})
export class RiskModule {}
