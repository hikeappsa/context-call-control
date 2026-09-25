import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Pool, type PoolClient } from 'pg';
import { requiredEnv } from '../config/env';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool = new Pool({ connectionString: requiredEnv('DATABASE_URL') });

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const directory = join(__dirname, '..', '..', 'migrations');
      const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
      for (const filename of files) {
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
        if (applied.rowCount) continue;
        const sql = await readFile(join(directory, filename), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
          await client.query('COMMIT');
          this.logger.log(`Applied ${filename}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async query<T>(text: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await this.pool.query(text, values);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
