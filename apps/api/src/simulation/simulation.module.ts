import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { DataModule } from '../data/data.module';
import { StrategyModule } from '../strategy/strategy.module';
import { SafetyModule } from '../safety/safety.module';
import { SimulatedTrade } from '../entities/simulated-trade.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SimulatedTrade]),
    DataModule,
    StrategyModule,
    forwardRef(() => SafetyModule),
  ],
  controllers: [SimulationController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class SimulationModule {}
