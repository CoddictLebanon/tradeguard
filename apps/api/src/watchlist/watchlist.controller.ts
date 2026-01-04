import { Controller, Get, Post, Delete, Put, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WatchlistService } from './watchlist.service';
import { AddToWatchlistDto, UpdateNotesDto } from './dto/watchlist.dto';

@Controller('watchlist')
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist() {
    return this.watchlistService.findAll();
  }

  @Get('active')
  async getActiveWatchlist() {
    return this.watchlistService.findActive();
  }

  @Post()
  async addToWatchlist(@Body() dto: AddToWatchlistDto) {
    const item = await this.watchlistService.add(dto.symbol, dto.notes);
    return { id: item.id };
  }

  @Delete(':id')
  async removeFromWatchlist(@Param('id') id: string) {
    const success = await this.watchlistService.remove(id);
    return { success };
  }

  @Put(':id/toggle')
  async toggleActive(@Param('id') id: string) {
    const item = await this.watchlistService.toggleActive(id);
    return { success: !!item, active: item?.active };
  }

  @Put(':id/notes')
  async updateNotes(@Param('id') id: string, @Body() dto: UpdateNotesDto) {
    const item = await this.watchlistService.updateNotes(id, dto.notes);
    return { success: !!item };
  }
}
