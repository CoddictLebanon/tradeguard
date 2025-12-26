import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('watchlist')
export class WatchlistItem extends BaseEntity {
  @Column({ unique: true })
  symbol: string;

  @Column({ nullable: true })
  notes: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: false })
  fromScreener: boolean;
}
