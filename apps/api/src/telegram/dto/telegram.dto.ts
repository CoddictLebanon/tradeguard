import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateTelegramConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  botToken?: string;

  @IsOptional()
  @IsString()
  chatId?: string;

  @IsOptional()
  @IsBoolean()
  notifyOpened?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyStopRaised?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyClosed?: boolean;
}
