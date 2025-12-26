import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OrderValidationService } from './order-validation.service';
import { SafetyController } from './safety.controller';
import { Trade } from '../entities/trade.entity';
import { Position } from '../entities/position.entity';
import { Setting } from '../entities/settings.entity';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, Position, Setting, ActivityLog]),
  ],
  controllers: [SafetyController],
  providers: [CircuitBreakerService, OrderValidationService],
  exports: [CircuitBreakerService, OrderValidationService],
})
export class SafetyModule {}
