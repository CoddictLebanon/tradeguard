import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Position } from './position.entity';

@Entity('pending_stop_updates')
export class PendingStopUpdate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  positionId: string;

  @ManyToOne(() => Position, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: Position;

  @Column()
  symbol: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  oldStopPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  newStopPrice: number;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRetryAt: Date | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: 'pending' | 'success' | 'failed';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
