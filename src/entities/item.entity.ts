import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';
import { generatePrimaryId } from '@/config/nanoid.config';

@Entity('items')
export class Item extends BaseEntity {
  @Column({ type: 'varchar', length: 16 })
  public readonly name: string = generatePrimaryId();

  @Column('decimal', { precision: 10, scale: 2 })
  public readonly price!: number;

  @Column({ type: 'text', nullable: true })
  public readonly description?: string | null;
}
