import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ActivityType {
  OPPORTUNITY_CREATED = 'opportunity_created',
  OPPORTUNITY_APPROVED = 'opportunity_approved',
  OPPORTUNITY_REJECTED = 'opportunity_rejected',
  ORDER_PLACED = 'order_placed',
  ORDER_FILLED = 'order_filled',
  STOP_TRIGGERED = 'stop_triggered',
  POSITION_OPENED = 'position_opened',
  POSITION_CLOSED = 'position_closed',
  TRADE_BLOCKED = 'trade_blocked',
  CIRCUIT_BREAKER = 'circuit_breaker',
  SETTING_CHANGED = 'setting_changed',
  TRAILING_STOP_UPDATED = 'trailing_stop_updated',
  SYSTEM = 'system',
}

@Entity('activity_log')
export class ActivityLog extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ActivityType,
  })
  type: ActivityType;

  @Column()
  message: string;

  @Column('jsonb', { nullable: true })
  details: Record<string, any>;

  @Column({ nullable: true })
  symbol: string;

  @Column({ nullable: true })
  positionId: string;
}
