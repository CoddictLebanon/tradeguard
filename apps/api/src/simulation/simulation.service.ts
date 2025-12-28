import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { TrailingStopService } from '../strategy/trailing-stop.service';
import { SimulationInput, SimulationResult } from './simulation.types';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly polygonService: PolygonService,
    private readonly trailingStopService: TrailingStopService,
  ) {}

  async runSimulation(input: SimulationInput): Promise<SimulationResult> {
    const { symbol, entryDate, entryPrice, shares, stopPrice, maxDays = 60 } = input;

    this.logger.log(`Running simulation for ${symbol} from ${entryDate}`);

    // Get bars from entry date forward (need ~90 calendar days for 60 trading days)
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

    return {
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
  }
}
