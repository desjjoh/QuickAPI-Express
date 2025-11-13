import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('items')
export class Item extends BaseEntity {
  @Column({ type: 'text', length: 100 })
  public readonly name!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  public readonly price!: number;

  @Column({ type: 'text', nullable: true })
  public readonly description?: string | null;
}
