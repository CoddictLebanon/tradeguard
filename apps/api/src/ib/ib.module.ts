import { Module } from '@nestjs/common';
import { IBService } from './ib.service';
import { IBController } from './ib.controller';

@Module({
  controllers: [IBController],
  providers: [IBService],
  exports: [IBService],
})
export class IBModule {}
