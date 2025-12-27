// apps/api/src/entities/trade-log.entity.ts

import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum TradeLogAction {
  FLAGGED = 'flagged',
  ENTERED = 'entered',
  EXITED = 'exited',
  REJECTED = 'rejected',
  STOP_MODIFIED = 'stop_modified',
}

@Entity('trade_logs')
export class TradeLog extends BaseEntity {
  @Column()
  symbol: string;

  @Column({
    type: 'enum',
    enum: TradeLogAction,
  })
  action: TradeLogAction;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  entryPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  stopPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  exitPrice: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  positionSizeDollars: number;

  @Column('int', { nullable: true })
  shares: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  dollarRisk: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  stopDistancePercent: number;

  @Column({ nullable: true })
  setupType: string;

  @Column({ nullable: true })
  rejectionReason: string;

  @Column({ nullable: true })
  exitReason: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  pnl: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  pnlPercent: number;

  @Column('text', { nullable: true })
  notes: string;
}
