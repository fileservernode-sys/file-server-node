import { PrismaClient } from '@prisma/client';
import { config } from './env.js';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      // connection_limit=3 prevents pool exhaustion on Render free tier
      // connect_timeout=30 gives the DB enough time to wake from sleep
      // socket_timeout=60 tolerates slow queries on cold MySQL
      url: config.DATABASE_URL
        ? `${config.DATABASE_URL}${config.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=3&connect_timeout=30&socket_timeout=60&pool_timeout=30`
        : undefined,
    },
  },
});

if (config.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

/**
 * Verifies active database connection for readiness probe
 */
export async function checkDatabaseReadiness(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Attempts to reconnect Prisma after a connection pool error.
 * Safe to call fire-and-forget.
 */
export async function reconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (_) { /* ignore */ }
  try {
    await prisma.$connect();
  } catch (_) { /* ignore */ }
}

/**
 * Graceful disconnect helper for SIGTERM / SIGINT signals
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    // Ignore disconnect errors during teardown
  }
  await disconnectDiagnosticDatabase();
  await disconnectControlledWriteDatabase();
  await disconnectControlledDestructiveDatabase();
}

let _diagnosticPrisma: PrismaClient | null = null;
let _controlledWritePrisma: PrismaClient | null = null;
let _controlledDestructivePrisma: PrismaClient | null = null;

/**
 * Returns an isolated Prisma client instance dedicated for the SQL Diagnostic Runner.
 * Uses ZDEX_SQL_DIAGNOSTIC_DATABASE_URL if configured, or fails closed if missing in strict production.
 */
export function getDiagnosticPrismaClient(failClosedIfUnconfigured = false): PrismaClient {
  if (_diagnosticPrisma) return _diagnosticPrisma;

  const url = config.ZDEX_SQL_DIAGNOSTIC_DATABASE_URL || config.DATABASE_URL;

  if (failClosedIfUnconfigured && !config.ZDEX_SQL_DIAGNOSTIC_DATABASE_URL) {
    throw new Error('SQL Diagnostic Database URL (ZDEX_SQL_DIAGNOSTIC_DATABASE_URL) is not configured');
  }

  if (!url) {
    throw new Error('No database connection URL available for diagnostic runner');
  }

  const separator = url.includes('?') ? '&' : '?';
  // Strictly isolated small connection limit (2 max) and tight timeouts
  const diagnosticUrl = `${url}${separator}connection_limit=2&connect_timeout=10&socket_timeout=10&pool_timeout=10`;

  _diagnosticPrisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: diagnosticUrl,
      },
    },
  });

  return _diagnosticPrisma;
}

export async function disconnectDiagnosticDatabase(): Promise<void> {
  if (_diagnosticPrisma) {
    try {
      await _diagnosticPrisma.$disconnect();
    } catch (_) { /* ignore */ }
    _diagnosticPrisma = null;
  }
}

/**
 * Returns an isolated Prisma client instance dedicated for Controlled Write SQL execution.
 * Inherently fail-closed: requires CONTROLLED_WRITE_DATABASE_URL or ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL.
 * Controlled Write Mode NEVER falls back to DATABASE_URL under any circumstances.
 */
export function getControlledWritePrismaClient(): PrismaClient {
  if (_controlledWritePrisma) return _controlledWritePrisma;

  const url = process.env.CONTROLLED_WRITE_DATABASE_URL ||
              config.CONTROLLED_WRITE_DATABASE_URL ||
              config.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL ||
              process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;

  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('Controlled write database URL (CONTROLLED_WRITE_DATABASE_URL) is not configured. Controlled write operations are prohibited.');
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('mysql://') && !trimmedUrl.startsWith('mariadb://')) {
    throw new Error('Controlled write database URL must be a valid MySQL connection string.');
  }

  const separator = trimmedUrl.includes('?') ? '&' : '?';
  // Isolated connection limit (2 max) and tight timeouts
  const writeUrl = `${trimmedUrl}${separator}connection_limit=2&connect_timeout=10&socket_timeout=10&pool_timeout=10`;

  _controlledWritePrisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: writeUrl,
      },
    },
  });

  return _controlledWritePrisma;
}

export async function disconnectControlledWriteDatabase(): Promise<void> {
  if (_controlledWritePrisma) {
    try {
      await _controlledWritePrisma.$disconnect();
    } catch (_) { /* ignore */ }
    _controlledWritePrisma = null;
  }
}

/**
 * Explicit test-only dependency injection helpers for Controlled Write Prisma Client.
 * Strictly isolated from production execution paths.
 */
export function _setControlledWritePrismaClientForTest(client: PrismaClient | null): void {
  _controlledWritePrisma = client;
}

export function _resetControlledWritePrismaClientForTest(): void {
  if (_controlledWritePrisma) {
    try {
      _controlledWritePrisma.$disconnect().catch(() => {});
    } catch (_) { /* ignore */ }
  }
  _controlledWritePrisma = null;
}

/**
 * Returns an isolated Prisma client instance dedicated for Destructive SQL execution (DELETE).
 * Inherently fail-closed: requires CONTROLLED_DESTRUCTIVE_DATABASE_URL or ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL.
 * Destructive Mode NEVER falls back to DATABASE_URL or CONTROLLED_WRITE_DATABASE_URL under any circumstances.
 */
export function getControlledDestructivePrismaClient(): PrismaClient {
  if (_controlledDestructivePrisma) return _controlledDestructivePrisma;

  const url = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL ||
              config.CONTROLLED_DESTRUCTIVE_DATABASE_URL ||
              config.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL ||
              process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('Controlled destructive database URL (CONTROLLED_DESTRUCTIVE_DATABASE_URL) is not configured. Destructive SQL operations are prohibited.');
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('mysql://') && !trimmedUrl.startsWith('mariadb://')) {
    throw new Error('Controlled destructive database URL must be a valid MySQL connection string.');
  }

  const separator = trimmedUrl.includes('?') ? '&' : '?';
  // Isolated connection limit (1 max) and tight timeouts
  const destUrl = `${trimmedUrl}${separator}connection_limit=1&connect_timeout=10&socket_timeout=10&pool_timeout=10`;

  _controlledDestructivePrisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: destUrl,
      },
    },
  });

  return _controlledDestructivePrisma;
}

export async function disconnectControlledDestructiveDatabase(): Promise<void> {
  if (_controlledDestructivePrisma) {
    try {
      await _controlledDestructivePrisma.$disconnect();
    } catch (_) { /* ignore */ }
    _controlledDestructivePrisma = null;
  }
}

/**
 * Explicit test-only dependency injection helpers for Controlled Destructive Prisma Client.
 * Strictly isolated from production execution paths.
 */
export function _setControlledDestructivePrismaClientForTest(client: PrismaClient | null): void {
  _controlledDestructivePrisma = client;
}

export function _resetControlledDestructivePrismaClientForTest(): void {
  if (_controlledDestructivePrisma) {
    try {
      _controlledDestructivePrisma.$disconnect().catch(() => {});
    } catch (_) { /* ignore */ }
  }
  _controlledDestructivePrisma = null;
}

