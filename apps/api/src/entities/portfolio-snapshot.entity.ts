import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('portfolio_snapshots')
export class PortfolioSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalValue: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  cash: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  positionsValue: number;

  @Column({ type: 'int', default: 0 })
  positionCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
