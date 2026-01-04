import { IsString, IsOptional, Matches } from 'class-validator';

export class AddToWatchlistDto {
  @IsString()
  @Matches(/^[A-Z]{1,5}$/, { message: 'Symbol must be 1-5 uppercase letters' })
  symbol: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateNotesDto {
  @IsString()
  notes: string;
}
