// apps/api/src/logging/trade-logging.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeLog, TradeLogAction } from '../entities/trade-log.entity';
import { TradeQualification, TradeSetupType, TradeRejectionReason } from '../strategy/conservative-trading.types';

@Injectable()
export class TradeLoggingService {
  private readonly logger = new Logger(TradeLoggingService.name);

  constructor(
    @InjectRepository(TradeLog)
    private tradeLogRepo: Repository<TradeLog>,
  ) {}

  async logFlagged(qualification: TradeQualification): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol: qualification.symbol,
      action: TradeLogAction.FLAGGED,
      entryPrice: qualification.entryPrice,
      stopPrice: qualification.stopPrice,
      positionSizeDollars: qualification.positionSizeDollars,
      shares: qualification.shares,
      dollarRisk: qualification.maxDollarRisk,
      stopDistancePercent: qualification.stopDistancePercent,
      setupType: qualification.setupType,
      notes: `Estimated upside: ${qualification.estimatedUpsidePercent?.toFixed(1)}%`,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED FLAGGED: ${qualification.symbol} - ${qualification.setupType}`);
    return log;
  }

  async logRejected(symbol: string, reason: TradeRejectionReason): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.REJECTED,
      rejectionReason: reason,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED REJECTED: ${symbol} - ${reason}`);
    return log;
  }

  async logEntered(
    symbol: string,
    entryPrice: number,
    stopPrice: number,
    shares: number,
    positionSizeDollars: number,
    dollarRisk: number,
    setupType: TradeSetupType,
  ): Promise<TradeLog> {
    const stopDistancePercent = ((entryPrice - stopPrice) / entryPrice) * 100;

    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.ENTERED,
      entryPrice,
      stopPrice,
      shares,
      positionSizeDollars,
      dollarRisk,
      stopDistancePercent,
      setupType,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED ENTERED: ${symbol} @ ${entryPrice}, stop ${stopPrice}, ${shares} shares`);
    return log;
  }

  async logExited(
    symbol: string,
    entryPrice: number,
    exitPrice: number,
    shares: number,
    exitReason: string,
  ): Promise<TradeLog> {
    const pnl = (exitPrice - entryPrice) * shares;
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;

    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.EXITED,
      entryPrice,
      exitPrice,
      shares,
      pnl,
      pnlPercent,
      exitReason,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED EXITED: ${symbol} @ ${exitPrice}, P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    return log;
  }

  async logStopModified(
    symbol: string,
    oldStop: number,
    newStop: number,
    shares: number,
  ): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.STOP_MODIFIED,
      stopPrice: newStop,
      shares,
      notes: `Stop moved from ${oldStop} to ${newStop}`,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED STOP MODIFIED: ${symbol} ${oldStop} -> ${newStop}`);
    return log;
  }

  async getRecentLogs(limit: number = 100): Promise<TradeLog[]> {
    return this.tradeLogRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getLogsBySymbol(symbol: string): Promise<TradeLog[]> {
    return this.tradeLogRepo.find({
      where: { symbol: symbol.toUpperCase() },
      order: { createdAt: 'DESC' },
    });
  }
}
