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
}
