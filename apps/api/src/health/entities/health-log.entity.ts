import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  CRITICAL = 'critical',
}

export enum HealthComponent {
  IB_GATEWAY = 'ib_gateway',
  IB_PROXY = 'ib_proxy',
  DATABASE = 'database',
  POSITION_SYNC = 'position_sync',
  CRON_JOBS = 'cron_jobs',
}

@Entity('health_logs')
export class HealthLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn()
  timestamp: Date;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  component: HealthComponent;

  @Column({ type: 'varchar', length: 20 })
  status: HealthStatus;

  @Column({ type: 'int', nullable: true })
  responseTime: number | null;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;
}
