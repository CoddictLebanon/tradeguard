import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('settings')
export class Setting {
  @PrimaryColumn()
  key: string;

  @Column('jsonb')
  value: any;

  @Column()
  updatedAt: Date;
}
