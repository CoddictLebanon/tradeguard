import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IBService } from './ib.service';
import { IBController } from './ib.controller';
import { IBEventsService } from './ib-events.service';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { SafetyModule } from '../safety/safety.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Trade, ActivityLog]),
    forwardRef(() => SafetyModule),
  ],
  controllers: [IBController],
  providers: [IBService, IBEventsService],
  exports: [IBService],
})
export class IBModule {}
