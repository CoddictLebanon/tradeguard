import { IsNumber, IsOptional, IsString, IsBoolean, Min, Max, IsIn } from 'class-validator';

export class UpdateLimitsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  dailyLossLimitPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weeklyLossLimitPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  monthlyLossLimitPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxOpenPositions?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxConsecutiveLosses?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxCapitalDeployedPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  minPaperTradeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  minPaperTrades?: number;
}

export class PauseResumeDto {
  @IsString()
  reason: string;
}

export class UpdateSimulationConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  maxDays?: number;
}

export class ValidateOrderDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0.01)
  price: number;

  @IsIn(['buy', 'sell'])
  side: 'buy' | 'sell';

  @IsNumber()
  @Min(0)
  portfolioValue: number;
}
