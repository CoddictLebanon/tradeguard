import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ExitReason {
  STOP_LOSS = 'stop_loss',
  MANUAL = 'manual',
  TARGET = 'target',
  CIRCUIT_BREAKER = 'circuit_breaker',
}

@Entity('trades')
export class Trade extends BaseEntity {
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

  @Column()
  openedAt: Date;

  @Column()
  closedAt: Date;

  @Column({
    type: 'enum',
    enum: ExitReason,
  })
  exitReason: ExitReason;

  @Column('text', { nullable: true })
  notes: string;
}
