export interface SafetyLimits {
  dailyLossLimit: number;       // Max loss per day (percentage of portfolio)
  weeklyLossLimit: number;      // Max loss per week (percentage)
  maxConsecutiveLosses: number; // Pause after X consecutive losses
  maxOpenPositions: number;     // Max simultaneous positions
  maxSectorExposure: number;    // Max % in single sector
  maxPositionSize: number;      // Max % per position
  minPaperTradeDays: number;    // Min days in paper mode
  minPaperTrades: number;       // Min trades in paper mode
}

export interface TradingState {
  mode: 'paper' | 'live';
  isPaused: boolean;
  pauseReason: string | null;
  pauseUntil: Date | null;
  dailyPnL: number;
  weeklyPnL: number;
  consecutiveLosses: number;
  openPositionsCount: number;
  paperTradeCount: number;
  paperTradingStartDate: Date | null;
}

export enum CircuitBreakerEvent {
  DAILY_LIMIT_HIT = 'daily_limit_hit',
  WEEKLY_LIMIT_HIT = 'weekly_limit_hit',
  CONSECUTIVE_LOSSES = 'consecutive_losses',
  MAX_POSITIONS = 'max_positions',
  SECTOR_EXPOSURE = 'sector_exposure',
  TRADING_PAUSED = 'trading_paused',
  TRADING_RESUMED = 'trading_resumed',
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  dailyLossLimit: 1.5,          // 1.5% daily loss limit
  weeklyLossLimit: 3.0,         // 3% weekly loss limit
  maxConsecutiveLosses: 5,
  maxOpenPositions: 20,
  maxSectorExposure: 30,        // 30% max in one sector
  maxPositionSize: 1,           // 1% max per position
  minPaperTradeDays: 14,        // 2 weeks minimum
  minPaperTrades: 50,           // 50 trades minimum
};
