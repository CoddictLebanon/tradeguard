import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityController } from './activity.controller';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog])],
  controllers: [ActivityController],
})
export class ActivityModule {}
