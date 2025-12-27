export interface SafetyLimits {
  dailyLossLimitPercent: number;    // 0.5%
  weeklyLossLimitPercent: number;   // 1.5%
  monthlyLossLimitPercent: number;  // 3%
  maxConsecutiveLosses: number;
  maxOpenPositions: number;         // 10-15
  maxCapitalDeployedPercent: number; // 20-30%
  minPaperTradeDays: number;
  minPaperTrades: number;
}

export interface TradingState {
  mode: 'paper' | 'live';
  isPaused: boolean;
  pauseReason: string | null;
  pauseUntil: Date | null;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  consecutiveLosses: number;
  openPositionsCount: number;
  capitalDeployed: number;
  paperTradeCount: number;
  paperTradingStartDate: Date | null;
}

export enum CircuitBreakerEvent {
  DAILY_LIMIT_HIT = 'daily_limit_hit',
  WEEKLY_LIMIT_HIT = 'weekly_limit_hit',
  MONTHLY_LIMIT_HIT = 'monthly_limit_hit',
  CONSECUTIVE_LOSSES = 'consecutive_losses',
  MAX_POSITIONS = 'max_positions',
  MAX_CAPITAL_DEPLOYED = 'max_capital_deployed',
  TRADING_PAUSED = 'trading_paused',
  TRADING_RESUMED = 'trading_resumed',
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  dailyLossLimitPercent: 0.5,       // 0.5% daily
  weeklyLossLimitPercent: 1.5,      // 1.5% weekly
  monthlyLossLimitPercent: 3.0,     // 3% monthly
  maxConsecutiveLosses: 5,
  maxOpenPositions: 12,
  maxCapitalDeployedPercent: 25,    // 25% max deployed
  minPaperTradeDays: 30,            // 1 month minimum
  minPaperTrades: 50,
};
