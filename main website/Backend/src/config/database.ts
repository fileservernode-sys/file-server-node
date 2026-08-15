import { PrismaClient } from '@prisma/client';
import { config } from './env.js';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
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
 * Graceful disconnect helper for SIGTERM / SIGINT signals
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    // Ignore disconnect errors during teardown
  }
}
