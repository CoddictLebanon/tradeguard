import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PolygonService } from '../data/polygon.service';
import { TrailingStopService } from '../strategy/trailing-stop.service';
import { CircuitBreakerService } from '../safety/circuit-breaker.service';
import { SimulationInput, SimulationResult } from './simulation.types';
import { SimulatedTrade } from '../entities/simulated-trade.entity';

export interface SimulationStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  avgPnLPercent: number;
  avgDaysHeld: number;
  avgRMultiple: number;
  bestTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
  worstTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
  totalCapitalDeployed: number;
  profitFactor: number;
}

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    @InjectRepository(SimulatedTrade)
    private simulatedTradeRepo: Repository<SimulatedTrade>,
    private readonly polygonService: PolygonService,
    private readonly trailingStopService: TrailingStopService,
    @Inject(forwardRef(() => CircuitBreakerService))
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async runSimulation(input: SimulationInput): Promise<SimulationResult> {
    // Get maxDays from config if not provided in input
    const simConfig = await this.circuitBreakerService.getSimulationConfig();
    const { symbol, entryDate, entryPrice, shares, stopPrice } = input;
    const maxDays = input.maxDays ?? simConfig.maxDays;

    this.logger.log(`Running simulation for ${symbol} from ${entryDate} (max ${maxDays} days)`);

    // Get bars from entry date forward (need extra calendar days for weekends/holidays)
    const toDate = new Date(entryDate);
    toDate.setDate(toDate.getDate() + Math.ceil(maxDays * 1.5));
    const toDateStr = toDate.toISOString().split('T')[0];

    const bars = await this.polygonService.getBarsForDateRange(
      symbol,
      entryDate,
      toDateStr,
      'day',
    );

    if (bars.length === 0) {
      throw new Error(`No data available for ${symbol} starting ${entryDate}`);
    }

    // Use structure-based trailing stop simulation
    const simulation = this.trailingStopService.simulateTrailingStop(
      bars,
      entryPrice,
      stopPrice,
      maxDays,
    );

    const pnl = (simulation.exitPrice - entryPrice) * shares;
    const pnlPercent = ((simulation.exitPrice - entryPrice) / entryPrice) * 100;

    // Find the highest price reached during the trade
    const highestPrice = simulation.dailyData.reduce(
      (max, day) => Math.max(max, day.high),
      entryPrice,
    );

    this.logger.log(
      `Simulation complete: ${symbol} ${entryDate} → ${simulation.exitDate}, ${simulation.daysHeld} days, ${pnlPercent.toFixed(2)}%`,
    );

    const result: SimulationResult = {
      symbol,
      entryDate,
      entryPrice,
      exitDate: simulation.exitDate,
      exitPrice: simulation.exitPrice,
      exitReason: simulation.exitReason,
      shares,
      daysHeld: simulation.daysHeld,
      pnl,
      pnlPercent,
      highestPrice,
      events: simulation.events,
      dailyData: simulation.dailyData,
    };

    // Save to database
    const initialRisk = (entryPrice - stopPrice) * shares;
    const rMultiple = initialRisk > 0 ? pnl / initialRisk : 0;

    await this.simulatedTradeRepo.save({
      symbol,
      entryPrice,
      exitPrice: simulation.exitPrice,
      shares,
      pnl,
      pnlPercent,
      highestPrice,
      entryDate: new Date(entryDate),
      exitDate: new Date(simulation.exitDate),
      exitReason: simulation.exitReason,
      daysHeld: simulation.daysHeld,
      initialStopPrice: stopPrice,
      finalStopPrice: simulation.events[simulation.events.length - 1]?.stopPrice || stopPrice,
      capitalDeployed: entryPrice * shares,
      rMultiple,
      simulationDate: entryDate,
      events: simulation.events,
      dailyData: simulation.dailyData,
    });

    return result;
  }

  async getSimulationHistory(limit = 50): Promise<SimulatedTrade[]> {
    return this.simulatedTradeRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getSimulationStats(): Promise<SimulationStats> {
    const trades = await this.simulatedTradeRepo.find();

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgPnL: 0,
        avgPnLPercent: 0,
        avgDaysHeld: 0,
        avgRMultiple: 0,
        bestTrade: null,
        worstTrade: null,
        totalCapitalDeployed: 0,
        profitFactor: 0,
      };
    }

    const winningTrades = trades.filter(t => Number(t.pnl) > 0);
    const losingTrades = trades.filter(t => Number(t.pnl) <= 0);

    const totalPnL = trades.reduce((sum, t) => sum + Number(t.pnl), 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + Number(t.pnl), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + Number(t.pnl), 0));

    const sortedByPnL = [...trades].sort((a, b) => Number(b.pnl) - Number(a.pnl));
    const best = sortedByPnL[0];
    const worst = sortedByPnL[sortedByPnL.length - 1];

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      totalPnL,
      avgPnL: totalPnL / trades.length,
      avgPnLPercent: trades.reduce((sum, t) => sum + Number(t.pnlPercent), 0) / trades.length,
      avgDaysHeld: trades.reduce((sum, t) => sum + Number(t.daysHeld), 0) / trades.length,
      avgRMultiple: trades.reduce((sum, t) => sum + Number(t.rMultiple), 0) / trades.length,
      bestTrade: best ? { symbol: best.symbol, pnl: Number(best.pnl), pnlPercent: Number(best.pnlPercent) } : null,
      worstTrade: worst ? { symbol: worst.symbol, pnl: Number(worst.pnl), pnlPercent: Number(worst.pnlPercent) } : null,
      totalCapitalDeployed: trades.reduce((sum, t) => sum + Number(t.capitalDeployed), 0),
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    };
  }

  async clearSimulationHistory(): Promise<number> {
    const result = await this.simulatedTradeRepo.delete({});
    this.logger.log(`Cleared ${result.affected} simulated trades`);
    return result.affected || 0;
  }
}
