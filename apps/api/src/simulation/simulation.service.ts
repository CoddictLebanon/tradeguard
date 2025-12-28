import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { SimulationInput, SimulationResult, SimulationEvent } from './simulation.types';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(private readonly polygonService: PolygonService) {}

  async runSimulation(input: SimulationInput): Promise<SimulationResult> {
    const { symbol, entryDate, entryPrice, shares, stopPrice, trailPercent, maxDays = 60 } = input;

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

    const events: SimulationEvent[] = [];
    const dailyData: SimulationResult['dailyData'] = [];

    let currentStop = stopPrice;
    let highestClose = entryPrice;
    let exitPrice = 0;
    let exitDate = '';
    let exitReason: SimulationResult['exitReason'] = 'data_ended';
    let daysHeld = 0;

    // Entry event
    events.push({
      day: 0,
      date: entryDate,
      type: 'ENTRY',
      price: entryPrice,
      stopPrice: currentStop,
      note: `Entered at $${entryPrice.toFixed(2)}, stop at $${currentStop.toFixed(2)}`,
    });

    // Process each day
    for (let i = 0; i < bars.length && daysHeld < maxDays; i++) {
      const bar = bars[i];
      const barDate = bar.timestamp.toISOString().split('T')[0];
      daysHeld++;

      // Check if stopped out (low touches stop)
      if (bar.low <= currentStop) {
        exitPrice = currentStop;
        exitDate = barDate;
        exitReason = 'stopped_out';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Stopped out at $${exitPrice.toFixed(2)}`,
        });

        dailyData.push({
          date: barDate,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          stopPrice: currentStop,
        });

        break;
      }

      // Update highest close and trail stop
      if (bar.close > highestClose) {
        highestClose = bar.close;
        const newStop = highestClose * (1 - trailPercent);

        if (newStop > currentStop) {
          const oldStop = currentStop;
          currentStop = newStop;

          events.push({
            day: daysHeld,
            date: barDate,
            type: 'STOP_RAISED',
            price: bar.close,
            stopPrice: currentStop,
            note: `New high $${highestClose.toFixed(2)}, stop raised $${oldStop.toFixed(2)} -> $${currentStop.toFixed(2)}`,
          });
        }
      }

      dailyData.push({
        date: barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        stopPrice: currentStop,
      });

      // If max days reached
      if (daysHeld >= maxDays) {
        exitPrice = bar.close;
        exitDate = barDate;
        exitReason = 'max_days';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Max holding period (${maxDays} days) reached, exited at $${exitPrice.toFixed(2)}`,
        });
      }
    }

    // If we ran out of data before exit
    if (!exitDate && dailyData.length > 0) {
      const lastBar = dailyData[dailyData.length - 1];
      exitPrice = lastBar.close;
      exitDate = lastBar.date;
      exitReason = 'data_ended';

      events.push({
        day: daysHeld,
        date: exitDate,
        type: 'EXIT',
        price: exitPrice,
        stopPrice: currentStop,
        note: `Data ended, final price $${exitPrice.toFixed(2)}`,
      });
    }

    const pnl = (exitPrice - entryPrice) * shares;
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;

    this.logger.log(
      `Simulation complete: ${symbol} ${entryDate} -> ${exitDate}, ${daysHeld} days, ${pnlPercent.toFixed(2)}%`,
    );

    return {
      symbol,
      entryDate,
      entryPrice,
      exitDate,
      exitPrice,
      exitReason,
      shares,
      daysHeld,
      pnl,
      pnlPercent,
      highestPrice: highestClose,
      events,
      dailyData,
    };
  }
}
