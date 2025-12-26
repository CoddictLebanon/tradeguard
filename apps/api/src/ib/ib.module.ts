import { Module } from '@nestjs/common';
import { IBService } from './ib.service';

@Module({
  providers: [IBService],
  exports: [IBService],
})
export class IBModule {}
