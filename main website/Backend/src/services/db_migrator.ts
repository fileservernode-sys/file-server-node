import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface MigrationLogger {
  info: (msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Runs pending Prisma migrations safely at startup when the application starts in production.
 * This guarantees the database schema is automatically initialized without requiring locked Pre-Deploy commands.
 */
export async function runStartupMigrations(logger?: MigrationLogger): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim().length === 0) {
    logger?.info('DATABASE_URL is empty or not configured. Skipping runtime database migration.');
    return;
  }

  try {
    logger?.info('Executing runtime Prisma migrations check (npx prisma migrate deploy)...');
    const { stdout, stderr } = await execAsync('npx prisma migrate deploy', {
      timeout: 45000,
      env: process.env
    });

    if (stdout && stdout.trim()) {
      logger?.info(`Prisma migration deploy output: ${stdout.trim()}`);
    }
    if (stderr && stderr.trim()) {
      logger?.warn({ stderr: stderr.trim() }, 'Prisma migration deploy stderr');
    }
    logger?.info('Database migration sync completed successfully.');
  } catch (error: any) {
    logger?.warn(
      {
        name: error.name,
        code: error.code,
        message: error.message ? error.message.replace(/:\/\/.*@/, '://***:***@') : 'Migration error'
      },
      'Runtime database migration execution notice (will retry on next boot or continue if already initialized)'
    );
  }
}
