import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RequestIdempotency1793059200000 implements MigrationInterface {
  name = 'RequestIdempotency1793059200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`request_idempotency\` (
      \`scope_hash\` char(64) NOT NULL,
      \`namespace\` varchar(256) NOT NULL,
      \`caller_scope\` varchar(128) NOT NULL,
      \`operation\` varchar(128) NOT NULL,
      \`route\` varchar(512) NOT NULL,
      \`fingerprint\` char(64) NOT NULL,
      \`state\` varchar(16) NOT NULL,
      \`response_status\` smallint UNSIGNED NULL,
      \`response_json\` mediumtext NULL,
      \`completed_at\` datetime(3) NULL,
      \`expires_at\` datetime(3) NULL,
      INDEX \`IDX_request_idempotency_expiry\` (\`state\`, \`expires_at\`),
      PRIMARY KEY (\`scope_hash\`)
    ) ENGINE=InnoDB`);
  }

  /** Drops replay history; offline downgrade only, never an online replay rollback. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `request_idempotency`');
  }
}
