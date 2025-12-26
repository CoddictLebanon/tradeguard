import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class PlaceBuyOrderDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitPrice?: number;

  @IsNumber()
  @Min(1)
  @Max(50)
  trailPercent: number;
}

export class PlaceSellOrderDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitPrice?: number;
}

export class ModifyStopDto {
  @IsNumber()
  orderId: number;

  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(1)
  @Max(50)
  trailPercent: number;
}
