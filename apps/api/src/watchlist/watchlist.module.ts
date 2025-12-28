import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { WatchlistItem } from '../entities/watchlist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WatchlistItem])],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
