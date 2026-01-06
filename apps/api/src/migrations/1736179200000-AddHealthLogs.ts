import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHealthLogs1736179200000 implements MigrationInterface {
  name = 'AddHealthLogs1736179200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS health_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        component VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        "responseTime" INTEGER,
        details JSONB
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_health_logs_timestamp ON health_logs(timestamp);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_health_logs_component ON health_logs(component);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_health_logs_component`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_health_logs_timestamp`);
    await queryRunner.query(`DROP TABLE IF EXISTS health_logs`);
  }
}
