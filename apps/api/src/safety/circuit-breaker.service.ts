import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Trade } from '../entities/trade.entity';
import { Position, PositionStatus } from '../entities/position.entity';
import { Setting } from '../entities/settings.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';
import {
  SafetyLimits,
  TradingState,
  CircuitBreakerEvent,
  DEFAULT_SAFETY_LIMITS,
} from './safety.types';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private limits: SafetyLimits = DEFAULT_SAFETY_LIMITS;
  private state: TradingState = {
    mode: 'paper',
    isPaused: false,
    pauseReason: null,
    pauseUntil: null,
    dailyPnL: 0,
    weeklyPnL: 0,
    consecutiveLosses: 0,
    openPositionsCount: 0,
    paperTradeCount: 0,
    paperTradingStartDate: null,
  };

  constructor(
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    try {
      const limitsSetting = await this.settingRepo.findOne({
        where: { key: 'safety_limits' },
      });
      if (limitsSetting) {
        this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limitsSetting.value };
      }

      const stateSetting = await this.settingRepo.findOne({
        where: { key: 'trading_state' },
      });
      if (stateSetting) {
        this.state = { ...this.state, ...stateSetting.value };
      }

      await this.refreshState();
    } catch (error) {
      this.logger.error(`Failed to load settings: ${error.message}`);
    }
  }

  private async saveState(): Promise<void> {
    await this.settingRepo.save({
      key: 'trading_state',
      value: this.state,
      updatedAt: new Date(),
    });
  }

  async refreshState(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    // Calculate daily P&L
    const todayTrades = await this.tradeRepo.find({
      where: { closedAt: MoreThan(today) },
    });
    this.state.dailyPnL = todayTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

    // Calculate weekly P&L
    const weekTrades = await this.tradeRepo.find({
      where: { closedAt: MoreThan(weekAgo) },
    });
    this.state.weeklyPnL = weekTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

    // Count open positions
    this.state.openPositionsCount = await this.positionRepo.count({
      where: { status: PositionStatus.OPEN },
    });

    // Calculate consecutive losses
    const recentTrades = await this.tradeRepo.find({
      order: { closedAt: 'DESC' },
      take: 20,
    });

    let consecutiveLosses = 0;
    for (const trade of recentTrades) {
      if (Number(trade.pnl) < 0) {
        consecutiveLosses++;
      } else {
        break;
      }
    }
    this.state.consecutiveLosses = consecutiveLosses;

    // Count paper trades
    if (this.state.mode === 'paper') {
      this.state.paperTradeCount = await this.tradeRepo.count();
    }

    await this.saveState();
  }

  // Run at market open to reset daily counters
  @Cron('30 9 * * 1-5', { timeZone: 'America/New_York' })
  async onMarketOpen(): Promise<void> {
    // Check if weekly pause should be lifted (Monday)
    const now = new Date();
    if (now.getDay() === 1 && this.state.pauseReason === 'weekly_limit') {
      await this.resumeTrading('Weekly limit reset');
    }

    await this.refreshState();
  }

  async canTrade(portfolioValue: number): Promise<{ allowed: boolean; reason?: string }> {
    await this.refreshState();

    // Check if trading is paused
    if (this.state.isPaused) {
      if (this.state.pauseUntil && new Date() > this.state.pauseUntil) {
        await this.resumeTrading('Pause period expired');
      } else {
        return { allowed: false, reason: this.state.pauseReason || 'Trading is paused' };
      }
    }

    // Check daily loss limit
    const dailyLossThreshold = (this.limits.dailyLossLimit / 100) * portfolioValue;
    if (this.state.dailyPnL < -dailyLossThreshold) {
      await this.pauseTrading('daily_limit', 'Daily loss limit reached');
      return { allowed: false, reason: `Daily loss limit of ${this.limits.dailyLossLimit}% reached` };
    }

    // Check weekly loss limit
    const weeklyLossThreshold = (this.limits.weeklyLossLimit / 100) * portfolioValue;
    if (this.state.weeklyPnL < -weeklyLossThreshold) {
      await this.pauseTrading('weekly_limit', 'Weekly loss limit reached', this.getNextMonday());
      return { allowed: false, reason: `Weekly loss limit of ${this.limits.weeklyLossLimit}% reached` };
    }

    // Check consecutive losses
    if (this.state.consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      await this.pauseTrading('consecutive_losses', `${this.state.consecutiveLosses} consecutive losses`);
      return { allowed: false, reason: `${this.state.consecutiveLosses} consecutive losses - manual review required` };
    }

    // Check max open positions
    if (this.state.openPositionsCount >= this.limits.maxOpenPositions) {
      return { allowed: false, reason: `Maximum ${this.limits.maxOpenPositions} open positions reached` };
    }

    return { allowed: true };
  }

  async validatePositionSize(
    positionValue: number,
    portfolioValue: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    const positionPercent = (positionValue / portfolioValue) * 100;

    if (positionPercent > this.limits.maxPositionSize) {
      return {
        valid: false,
        reason: `Position size ${positionPercent.toFixed(2)}% exceeds max ${this.limits.maxPositionSize}%`,
      };
    }

    return { valid: true };
  }

  async canSwitchToLive(): Promise<{ allowed: boolean; reason?: string }> {
    if (this.state.mode === 'live') {
      return { allowed: true };
    }

    // Check minimum paper trading period
    if (this.state.paperTradingStartDate) {
      const daysSincePaperStart = Math.floor(
        (Date.now() - new Date(this.state.paperTradingStartDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSincePaperStart < this.limits.minPaperTradeDays) {
        return {
          allowed: false,
          reason: `Need ${this.limits.minPaperTradeDays - daysSincePaperStart} more days of paper trading`,
        };
      }
    }

    // Check minimum paper trades
    if (this.state.paperTradeCount < this.limits.minPaperTrades) {
      return {
        allowed: false,
        reason: `Need ${this.limits.minPaperTrades - this.state.paperTradeCount} more paper trades`,
      };
    }

    // Check if paper trading was profitable
    const allTrades = await this.tradeRepo.find();
    const totalPnL = allTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

    if (totalPnL <= 0) {
      return {
        allowed: false,
        reason: 'Paper trading must be profitable before switching to live',
      };
    }

    return { allowed: true };
  }

  async switchToLive(): Promise<{ success: boolean; reason?: string }> {
    const check = await this.canSwitchToLive();
    if (!check.allowed) {
      return { success: false, reason: check.reason };
    }

    this.state.mode = 'live';
    await this.saveState();

    await this.activityRepo.save({
      type: ActivityType.SETTING_CHANGED,
      message: 'Switched to LIVE trading mode',
      details: { previousMode: 'paper', newMode: 'live' },
    });

    this.logger.warn('SWITCHED TO LIVE TRADING MODE');
    return { success: true };
  }

  async switchToPaper(): Promise<void> {
    this.state.mode = 'paper';
    this.state.paperTradingStartDate = new Date();
    this.state.paperTradeCount = 0;
    await this.saveState();

    await this.activityRepo.save({
      type: ActivityType.SETTING_CHANGED,
      message: 'Switched to PAPER trading mode',
      details: { previousMode: 'live', newMode: 'paper' },
    });

    this.logger.log('Switched to paper trading mode');
  }

  private async pauseTrading(
    reason: string,
    message: string,
    until?: Date,
  ): Promise<void> {
    this.state.isPaused = true;
    this.state.pauseReason = reason;
    this.state.pauseUntil = until || null;
    await this.saveState();

    await this.activityRepo.save({
      type: ActivityType.CIRCUIT_BREAKER,
      message: `Trading paused: ${message}`,
      details: { reason, pauseUntil: until },
    });

    this.eventEmitter.emit('circuit.breaker', {
      event: CircuitBreakerEvent.TRADING_PAUSED,
      reason,
      message,
      until,
    });

    this.logger.warn(`TRADING PAUSED: ${message}`);
  }

  async manualPause(reason: string): Promise<void> {
    this.state.isPaused = true;
    this.state.pauseReason = `manual: ${reason}`;
    this.state.pauseUntil = null;
    await this.saveState();

    await this.activityRepo.save({
      type: ActivityType.CIRCUIT_BREAKER,
      message: `Trading manually paused: ${reason}`,
      details: { reason, manual: true },
    });

    this.eventEmitter.emit('circuit.breaker', {
      event: CircuitBreakerEvent.TRADING_PAUSED,
      reason: `manual: ${reason}`,
      message: reason,
      manual: true,
    });

    this.logger.warn(`TRADING MANUALLY PAUSED: ${reason}`);
  }

  async resumeTrading(reason: string): Promise<void> {
    this.state.isPaused = false;
    this.state.pauseReason = null;
    this.state.pauseUntil = null;
    this.state.consecutiveLosses = 0;
    await this.saveState();

    await this.activityRepo.save({
      type: ActivityType.CIRCUIT_BREAKER,
      message: `Trading resumed: ${reason}`,
      details: { reason },
    });

    this.eventEmitter.emit('circuit.breaker', {
      event: CircuitBreakerEvent.TRADING_RESUMED,
      reason,
    });

    this.logger.log(`Trading resumed: ${reason}`);
  }

  private getNextMonday(): Date {
    const now = new Date();
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 30, 0, 0);
    return nextMonday;
  }

  async updateLimits(limits: Partial<SafetyLimits>): Promise<void> {
    this.limits = { ...this.limits, ...limits };
    await this.settingRepo.save({
      key: 'safety_limits',
      value: this.limits,
      updatedAt: new Date(),
    });

    await this.activityRepo.save({
      type: ActivityType.SETTING_CHANGED,
      message: 'Safety limits updated',
      details: limits,
    });
  }

  getState(): TradingState {
    return { ...this.state };
  }

  getLimits(): SafetyLimits {
    return { ...this.limits };
  }

  getTradingMode(): 'paper' | 'live' {
    return this.state.mode;
  }

  isPaperMode(): boolean {
    return this.state.mode === 'paper';
  }
}
