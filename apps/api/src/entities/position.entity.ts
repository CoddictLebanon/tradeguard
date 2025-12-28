import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum PositionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  PENDING = 'pending',
}

@Entity('positions')
export class Position extends BaseEntity {
  @Column()
  symbol: string;

  @Column('decimal', { precision: 10, scale: 2 })
  entryPrice: number;

  @Column('int')
  shares: number;

  @Column('decimal', { precision: 10, scale: 2 })
  stopPrice: number;

  @Column('decimal', { precision: 5, scale: 2 })
  trailPercent: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  currentPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  highestPrice: number;

  // Structure-based trailing stop fields
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  structuralHigh: number; // Reference high for current structure

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  structuralLow: number; // Defended low used for stop calculation

  @Column({ nullable: true })
  structuralHighDate: Date; // Date of the structural high

  @Column({
    type: 'enum',
    enum: PositionStatus,
    default: PositionStatus.PENDING,
  })
  status: PositionStatus;

  @Column({ nullable: true })
  ibOrderId: string;

  @Column({ nullable: true })
  ibStopOrderId: string;

  @Column({ nullable: true })
  openedAt: Date;

  @Column({ nullable: true })
  closedAt: Date;
}
