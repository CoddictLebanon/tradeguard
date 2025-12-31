import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('simulated_trades')
export class SimulatedTrade extends BaseEntity {
  @Column()
  symbol: string;

  @Column('decimal', { precision: 10, scale: 2 })
  entryPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  exitPrice: number;

  @Column('int')
  shares: number;

  @Column('decimal', { precision: 10, scale: 2 })
  pnl: number;

  @Column('decimal', { precision: 5, scale: 2 })
  pnlPercent: number;

  @Column('decimal', { precision: 10, scale: 2 })
  highestPrice: number;

  @Column()
  entryDate: Date;

  @Column()
  exitDate: Date;

  @Column()
  exitReason: string;

  @Column('int')
  daysHeld: number;

  // Risk metrics
  @Column('decimal', { precision: 10, scale: 2 })
  initialStopPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  finalStopPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  capitalDeployed: number;

  @Column('decimal', { precision: 5, scale: 2 })
  rMultiple: number;

  // Simulation context
  @Column({ nullable: true })
  simulationDate: string; // The "as of" date used for the simulation

  @Column('simple-json', { nullable: true })
  events: Array<{
    day: number;
    date: string;
    type: string;
    price: number;
    stopPrice: number;
    note?: string;
  }>;

  @Column('simple-json', { nullable: true })
  dailyData: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    stopPrice: number;
  }>;
}
