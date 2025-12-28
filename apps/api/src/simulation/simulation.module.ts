import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { DataModule } from '../data/data.module';

@Module({
  imports: [DataModule],
  controllers: [SimulationController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class SimulationModule {}
