export interface SimulationInput {
  symbol: string;
  entryDate: string; // YYYY-MM-DD
  entryPrice: number;
  shares: number;
  stopPrice: number;
  trailPercent: number; // e.g., 0.06 for 6%
  maxDays?: number; // default 60
}

export interface SimulationEvent {
  day: number;
  date: string;
  type: 'ENTRY' | 'STOP_RAISED' | 'EXIT';
  price: number;
  stopPrice: number;
  note?: string;
}

export interface SimulationResult {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'stopped_out' | 'max_days' | 'data_ended';
  shares: number;
  daysHeld: number;
  pnl: number;
  pnlPercent: number;
  highestPrice: number;
  events: SimulationEvent[];
  dailyData: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    stopPrice: number;
  }>;
}
