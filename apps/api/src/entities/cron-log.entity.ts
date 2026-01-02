import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type CronLogStatus = 'running' | 'success' | 'partial' | 'failed';

export interface CronLogDetail {
  positionId: string;
  symbol: string;
  action: 'raised' | 'unchanged' | 'failed';
  oldStopPrice?: number;
  newStopPrice?: number;
  error?: string;
}

@Entity('cron_logs')
export class CronLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  jobName: string;

  @Column({ type: 'varchar', default: 'running' })
  status: CronLogStatus;

  @Column({ type: 'timestamp' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ type: 'int', default: 0 })
  positionsChecked: number;

  @Column({ type: 'int', default: 0 })
  stopsRaised: number;

  @Column({ type: 'int', default: 0 })
  failures: number;

  @Column({ type: 'jsonb', default: [] })
  details: CronLogDetail[];

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}
