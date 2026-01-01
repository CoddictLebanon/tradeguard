import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IBService } from './ib.service';
import { IBController } from './ib.controller';
import { IBEventsService } from './ib-events.service';
import { IBProxyManagerService } from './ib-proxy-manager.service';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { SafetyModule } from '../safety/safety.module';
import { DataModule } from '../data/data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Trade, ActivityLog]),
    forwardRef(() => SafetyModule),
    DataModule,
  ],
  controllers: [IBController],
  providers: [IBService, IBEventsService, IBProxyManagerService],
  exports: [IBService, IBProxyManagerService],
})
export class IBModule {}
