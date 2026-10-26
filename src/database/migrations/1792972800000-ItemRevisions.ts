import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ItemRevisions1792972800000 implements MigrationInterface {
  name = 'ItemRevisions1792972800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `items` ADD `version` int UNSIGNED NOT NULL DEFAULT 1');
  }

  /** Offline/schema downgrade only: discards revision history, not a safe writer rollback. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `items` DROP COLUMN `version`');
  }
}
