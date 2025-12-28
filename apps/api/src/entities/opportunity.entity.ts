import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum OpportunityStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

@Entity('opportunities')
export class Opportunity extends BaseEntity {
  @Column()
  symbol: string;

  @Column({ nullable: true })
  companyName: string;

  @Column({ nullable: true })
  logoUrl: string;

  @Column('decimal', { precision: 5, scale: 2 })
  score: number;

  @Column('jsonb')
  factors: Record<string, number | string | boolean>;

  @Column('decimal', { precision: 10, scale: 2 })
  currentPrice: number;

  @Column('text', { nullable: true })
  aiAnalysis: string;

  @Column('text', { nullable: true })
  bullCase: string;

  @Column('text', { nullable: true })
  bearCase: string;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  aiConfidence: number;

  @Column({ nullable: true })
  aiRecommendation: string; // BUY, HOLD, AVOID

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  suggestedEntry: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  suggestedTrailPercent: number;

  @Column({
    type: 'enum',
    enum: OpportunityStatus,
    default: OpportunityStatus.PENDING,
  })
  status: OpportunityStatus;

  @Column({ nullable: true })
  expiresAt: Date;
}
