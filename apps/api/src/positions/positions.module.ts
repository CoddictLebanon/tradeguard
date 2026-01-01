import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { Position } from '../entities/position.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { IBModule } from '../ib/ib.module';
import { DataModule } from '../data/data.module';

@Module({
  imports: [TypeOrmModule.forFeature([Position, ActivityLog]), IBModule, DataModule],
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
