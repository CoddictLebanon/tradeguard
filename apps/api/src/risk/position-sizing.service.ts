// apps/api/src/risk/position-sizing.service.ts

import { Injectable, Logger } from '@nestjs/common';
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
export class PositionSizingService {
  private readonly logger = new Logger(PositionSizingService.name);
  private accountConfig: AccountConfig = DEFAULT_ACCOUNT_CONFIG;
  private riskLimits: RiskLimits = DEFAULT_RISK_LIMITS;

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {
    this.loadConfig();
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
    const newTotalDeployed = currentCapitalDeployed + actualPositionSize;
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
}
