// apps/api/src/strategy/conservative-trading.types.ts

export interface AccountConfig {
  totalCapital: number;           // e.g., 1_000_000 (equity)
  riskPerTradePercent: number;    // 0.15% = 0.0015 -> $1,500 risk per trade
  maxCapitalDeployedPercent: number; // 20-30%
  stopBuffer: number;             // 0.007 = 0.7% buffer below pullback_low
}

export interface RiskLimits {
  dailyLossLimitPercent: number;    // 0.5%
  weeklyLossLimitPercent: number;   // 1.5%
  monthlyLossLimitPercent: number;  // 3%
  maxOpenPositions: number;         // 10-15
  minStopDistancePercent: number;   // 2%
  maxStopDistancePercent: number;   // 6%
}

export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  totalCapital: 1_000_000,
  riskPerTradePercent: 0.15,  // 0.15% of capital = $1,500 per trade
  maxCapitalDeployedPercent: 25,
  stopBuffer: 0.007,  // 0.7% buffer below pullback_low for stop
};

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  dailyLossLimitPercent: 0.5,
  weeklyLossLimitPercent: 1.5,
  monthlyLossLimitPercent: 3.0,
  maxOpenPositions: 12,
  minStopDistancePercent: 2,
  maxStopDistancePercent: 6,
};

export enum TradeSetupType {
  MEAN_REVERSION_PULLBACK = 'mean_reversion_pullback',
  MA_PULLBACK_20 = 'ma_pullback_20',
  MA_PULLBACK_50 = 'ma_pullback_50',
  OVERSOLD_STABILIZATION = 'oversold_stabilization',
  BREAKOUT_RETEST = 'breakout_retest',
}

export enum TradeRejectionReason {
  NOT_IN_UNIVERSE = 'not_in_universe',
  BELOW_200_MA = 'below_200_ma',
  MA_200_DECLINING = 'ma_200_declining',
  VOLUME_TOO_LOW = 'volume_too_low',
  STOP_TOO_TIGHT = 'stop_too_tight',
  STOP_TOO_WIDE = 'stop_too_wide',
  EARNINGS_SOON = 'earnings_soon',
  DAILY_LIMIT_HIT = 'daily_limit_hit',
  WEEKLY_LIMIT_HIT = 'weekly_limit_hit',
  MONTHLY_LIMIT_HIT = 'monthly_limit_hit',
  MAX_POSITIONS = 'max_positions',
  MAX_CAPITAL_DEPLOYED = 'max_capital_deployed',
  NO_VALID_SETUP = 'no_valid_setup',
}

export interface TradeQualification {
  symbol: string;
  qualified: boolean;
  rejectionReason?: TradeRejectionReason;

  // If qualified, these are populated
  setupType?: TradeSetupType;
  entryPrice?: number;
  stopPrice?: number;
  stopDistancePercent?: number;
  positionSizeDollars?: number;
  shares?: number;
  maxDollarRisk?: number;
  estimatedUpsidePercent?: number;
}

export interface TradeLogEntry {
  id: string;
  timestamp: Date;
  symbol: string;
  action: 'FLAGGED' | 'ENTERED' | 'EXITED' | 'REJECTED';
  entryPrice?: number;
  stopPrice?: number;
  exitPrice?: number;
  positionSizeDollars?: number;
  shares?: number;
  dollarRisk?: number;
  exitReason?: string;
  pnl?: number;
  pnlPercent?: number;
  setupType?: TradeSetupType;
  rejectionReason?: TradeRejectionReason;
  notes?: string;
}
