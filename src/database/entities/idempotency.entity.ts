import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('request_idempotency')
@Index('IDX_request_idempotency_expiry', ['state', 'expires_at'])
export class IdempotencyEntity {
  @PrimaryColumn({ type: 'char', length: 64 })
  public readonly scope_hash!: string;

  @Column({ type: 'varchar', length: 256 })
  public readonly namespace!: string;

  @Column({ type: 'varchar', length: 128 })
  public readonly caller_scope!: string;

  @Column({ type: 'varchar', length: 128 })
  public readonly operation!: string;

  @Column({ type: 'varchar', length: 512 })
  public readonly route!: string;

  @Column({ type: 'char', length: 64 })
  public readonly fingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  public readonly state!: 'processing' | 'completed';

  @Column({ type: 'smallint', unsigned: true, nullable: true })
  public readonly response_status!: number | null;

  @Column({ type: 'mediumtext', nullable: true })
  public readonly response_json!: string | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  public readonly completed_at!: Date | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  public readonly expires_at!: Date | null;
}
