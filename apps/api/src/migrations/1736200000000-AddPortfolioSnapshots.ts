import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortfolioSnapshots1736200000000 implements MigrationInterface {
  name = 'AddPortfolioSnapshots1736200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL UNIQUE,
        "totalValue" DECIMAL(15,2) NOT NULL,
        cash DECIMAL(15,2),
        "positionsValue" DECIMAL(15,2),
        "positionCount" INT DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Note: PostgreSQL automatically creates a unique index for the UNIQUE constraint on date column
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS portfolio_snapshots');
  }
}
