// apps/api/src/risk/position-sizing.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/settings.entity';
import {
  AccountConfig,
  DEFAULT_ACCOUNT_CONFIG,
  DEFAULT_RISK_LIMITS,
  RiskLimits,
} from '../strategy/conservative-trading.types';

export interface PositionSizeResult {
  valid: boolean;
  reason?: string;
  positionSizeDollars: number;
  shares: number;
  maxDollarRisk: number;
  stopDistancePercent: number;
  capitalDeploymentPercent: number;
}

@Injectable()
export class PositionSizingService implements OnModuleInit {
  private readonly logger = new Logger(PositionSizingService.name);
  private accountConfig: AccountConfig = DEFAULT_ACCOUNT_CONFIG;
  private riskLimits: RiskLimits = DEFAULT_RISK_LIMITS;

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const accountSetting = await this.settingRepo.findOne({
        where: { key: 'account_config' },
      });
      if (accountSetting) {
        this.accountConfig = { ...DEFAULT_ACCOUNT_CONFIG, ...accountSetting.value };
      }

      const riskSetting = await this.settingRepo.findOne({
        where: { key: 'risk_limits' },
      });
      if (riskSetting) {
        this.riskLimits = { ...DEFAULT_RISK_LIMITS, ...riskSetting.value };
      }
    } catch (error) {
      this.logger.error(`Failed to load config: ${(error as Error).message}`);
    }
  }

  calculatePositionSize(
    entryPrice: number,
    stopPrice: number,
    currentCapitalDeployed: number,
  ): PositionSizeResult {
    // Input validation
    if (entryPrice <= 0 || stopPrice <= 0) {
      return {
        valid: false,
        reason: 'Entry and stop prices must be positive',
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent: 0,
        capitalDeploymentPercent: 0,
      };
    }

    if (stopPrice >= entryPrice) {
      return {
        valid: false,
        reason: 'Stop price must be below entry price for long positions',
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent: 0,
        capitalDeploymentPercent: 0,
      };
    }

    // Sanitize negative capital deployed
    const sanitizedCapitalDeployed = Math.max(0, currentCapitalDeployed);

    // Calculate stop distance
    const stopDistance = Math.abs(entryPrice - stopPrice);
    const stopDistancePercent = (stopDistance / entryPrice) * 100;

    // Validate stop distance is within bounds
    if (stopDistancePercent < this.riskLimits.minStopDistancePercent) {
      return {
        valid: false,
        reason: `Stop distance ${stopDistancePercent.toFixed(2)}% is below minimum ${this.riskLimits.minStopDistancePercent}%`,
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent,
        capitalDeploymentPercent: 0,
      };
    }

    if (stopDistancePercent > this.riskLimits.maxStopDistancePercent) {
      return {
        valid: false,
        reason: `Stop distance ${stopDistancePercent.toFixed(2)}% exceeds maximum ${this.riskLimits.maxStopDistancePercent}%`,
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent,
        capitalDeploymentPercent: 0,
      };
    }

    // Calculate max dollar risk
    const maxDollarRisk = this.accountConfig.totalCapital * (this.accountConfig.riskPerTradePercent / 100);

    // Calculate position size: Position = MaxRisk / StopDistance%
    const positionSizeDollars = maxDollarRisk / (stopDistancePercent / 100);

    // Calculate shares (round down to avoid exceeding risk)
    const shares = Math.floor(positionSizeDollars / entryPrice);
    const actualPositionSize = shares * entryPrice;

    // Check if this would exceed max capital deployment
    const newTotalDeployed = sanitizedCapitalDeployed + actualPositionSize;
    const capitalDeploymentPercent = (newTotalDeployed / this.accountConfig.totalCapital) * 100;

    if (capitalDeploymentPercent > this.accountConfig.maxCapitalDeployedPercent) {
      return {
        valid: false,
        reason: `Position would bring total deployment to ${capitalDeploymentPercent.toFixed(1)}%, exceeding max ${this.accountConfig.maxCapitalDeployedPercent}%`,
        positionSizeDollars: actualPositionSize,
        shares,
        maxDollarRisk,
        stopDistancePercent,
        capitalDeploymentPercent,
      };
    }

    return {
      valid: true,
      positionSizeDollars: actualPositionSize,
      shares,
      maxDollarRisk,
      stopDistancePercent,
      capitalDeploymentPercent,
    };
  }

  getMaxDollarRisk(): number {
    return this.accountConfig.totalCapital * (this.accountConfig.riskPerTradePercent / 100);
  }

  getAccountConfig(): AccountConfig {
    return { ...this.accountConfig };
  }

  getRiskLimits(): RiskLimits {
    return { ...this.riskLimits };
  }

  async updateAccountConfig(config: Partial<AccountConfig>): Promise<void> {
    this.accountConfig = { ...this.accountConfig, ...config };
    await this.settingRepo.save({
      key: 'account_config',
      value: this.accountConfig,
      updatedAt: new Date(),
    });
  }

  async updateRiskLimits(limits: Partial<RiskLimits>): Promise<void> {
    this.riskLimits = { ...this.riskLimits, ...limits };
    await this.settingRepo.save({
      key: 'risk_limits',
      value: this.riskLimits,
      updatedAt: new Date(),
    });
  }

  /**
   * Ultra-conservative swing-trading position sizing
   *
   * Rules:
   * - STOP = PULLBACK_LOW * (1 - BUFFER)
   * - stop_pct = (ENTRY - STOP) / ENTRY
   * - MAX_STOP_PCT = 0.06 (6%) - REJECT if exceeded
   * - RISK_USD = EQUITY * RISK_PCT
   * - shares = floor(RISK_USD / (ENTRY - STOP))
   * - position_usd = shares * ENTRY
   */
  calculateSwingPosition(input: {
    symbol: string;
    entry: number;
    pullbackLow: number;
    buffer?: number;
  }): {
    status: 'OK' | 'REJECT';
    symbol: string;
    entry: number;
    stop: number | null;
    stop_pct: number | null;
    risk_usd?: number;
    risk_per_share?: number;
    shares?: number;
    position_usd?: number;
    max_loss_usd?: number;
    reason?: string;
  } {
    const { symbol, entry, pullbackLow } = input;
    const buffer = input.buffer ?? this.accountConfig.stopBuffer ?? 0.007;
    const equity = this.accountConfig.totalCapital;
    const riskPct = this.accountConfig.riskPerTradePercent / 100; // Convert 0.15 to 0.0015

    // Calculate STOP = PULLBACK_LOW * (1 - BUFFER)
    const stop = Math.round(pullbackLow * (1 - buffer) * 100) / 100;

    // Validate entry > stop
    if (entry <= stop) {
      return {
        status: 'REJECT',
        symbol,
        entry,
        stop,
        stop_pct: null,
        reason: 'Entry price must be above stop price',
      };
    }

    // Calculate stop_pct = (ENTRY - STOP) / ENTRY
    const stopPct = (entry - stop) / entry;

    // Calculate RISK_USD = EQUITY * RISK_PCT
    const riskUsd = Math.round(equity * riskPct * 100) / 100;

    // Calculate risk_per_share = ENTRY - STOP
    const riskPerShare = entry - stop;

    // Calculate shares = floor(RISK_USD / risk_per_share)
    const shares = Math.floor(riskUsd / riskPerShare);

    // Calculate position_usd = shares * ENTRY
    const positionUsd = Math.round(shares * entry * 100) / 100;

    // Calculate actual max loss = shares * risk_per_share
    const maxLossUsd = Math.round(shares * riskPerShare * 100) / 100;

    // Common result fields
    const result = {
      symbol,
      entry,
      stop,
      stop_pct: stopPct,
      risk_usd: riskUsd,
      risk_per_share: Math.round(riskPerShare * 100) / 100,
      shares,
      position_usd: positionUsd,
      max_loss_usd: maxLossUsd,
    };

    // Enforce MAX_STOP_PCT = 0.06 (6%)
    const maxStopPct = this.riskLimits.maxStopDistancePercent / 100; // Convert 6 to 0.06
    if (stopPct > maxStopPct) {
      return {
        status: 'REJECT' as const,
        ...result,
        reason: `Stop distance ${(stopPct * 100).toFixed(2)}% exceeds maximum ${this.riskLimits.maxStopDistancePercent}%`,
      };
    }

    // Validate shares > 0
    if (shares <= 0) {
      return {
        status: 'REJECT' as const,
        ...result,
        reason: 'Position size too small (0 shares)',
      };
    }

    return {
      status: 'OK' as const,
      ...result,
    };
  }
}
