import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../config/database.js';

const execAsync = promisify(exec);

export interface MigrationLogger {
  info: (msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}

/**
 * Runs pending Prisma migrations safely at startup when the application boots in production.
 * If an obsolete/failed migration record from a prior failed deploy is detected in _prisma_migrations,
 * it automatically clears the unapplied migration lock so the baseline migration can deploy cleanly.
 */
export async function runStartupMigrations(logger?: MigrationLogger): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim().length === 0) {
    logger?.info('DATABASE_URL is empty or not configured. Skipping runtime database migration.');
    return;
  }

  const runDeploy = async () => {
    return await execAsync('npx prisma migrate deploy', {
      timeout: 45000,
      env: process.env
    });
  };

  try {
    logger?.info('Executing runtime Prisma migrations check (npx prisma migrate deploy)...');
    const { stdout, stderr } = await runDeploy();

    if (stdout && stdout.trim()) {
      logger?.info(`Prisma migration deploy output: ${stdout.trim()}`);
    }
    if (stderr && stderr.trim()) {
      logger?.warn({ stderr: stderr.trim() }, 'Prisma migration deploy stderr');
    }
    logger?.info('Database migration sync completed successfully.');
  } catch (error: any) {
    const errorMessage = error?.message || '';
    const isFailedMigrationLock = errorMessage.includes('P3009') || errorMessage.includes('failed migrations in the target database');

    if (isFailedMigrationLock) {
      logger?.warn(
        { err: error.message },
        'Detected stale/failed migration record (P3009) in _prisma_migrations. Attempting automatic recovery...'
      );

      try {
        // Clear unapplied/failed migration rows that never completed (finished_at IS NULL)
        const deletedRows = await prisma.$executeRawUnsafe(
          'DELETE FROM `_prisma_migrations` WHERE `finished_at` IS NULL OR `rolled_back_at` IS NOT NULL'
        );
        logger?.info(`Cleared ${deletedRows} stale migration record(s) from _prisma_migrations.`);

        // Retry migration deploy
        const retryResult = await runDeploy();
        if (retryResult.stdout && retryResult.stdout.trim()) {
          logger?.info(`Prisma migration deploy output after recovery: ${retryResult.stdout.trim()}`);
        }
        logger?.info('Database migration sync completed successfully after recovering stale migration lock.');
        return;
      } catch (recoveryErr: any) {
        logger?.error(
          { err: recoveryErr.message },
          'Failed automatic recovery of failed migration record in _prisma_migrations.'
        );
        throw new Error(`Database migration failed and could not be recovered: ${recoveryErr.message}`);
      }
    }

    logger?.error(
      {
        name: error.name,
        code: error.code,
        message: error.message ? error.message.replace(/:\/\/.*@/, '://***:***@') : 'Migration error'
      },
      'Fatal database migration failure during startup'
    );
    throw error;
  }
}
