import { Module } from '@nestjs/common';
import { PolygonService } from './polygon.service';
import { FinnhubService } from './finnhub.service';

@Module({
  providers: [PolygonService, FinnhubService],
  exports: [PolygonService, FinnhubService],
})
export class DataModule {}
