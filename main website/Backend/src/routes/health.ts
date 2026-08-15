import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/health
   * Process Liveness Probe: Differentiates process liveness from database readiness.
   * Does NOT expose secrets, credentials, or system paths.
   */
  app.get('/health', async () => {
    return createSuccessResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  /**
   * GET /api/v1/health/db
   * Database Connectivity Verification Probe.
   * Executes a minimal SELECT 1 query via the Prisma singleton.
   * Returns safe status without leaking credentials, connection strings, or stack traces.
   */
  app.get('/health/db', async (_request, reply: FastifyReply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.status(200).send(
        createSuccessResponse({
          status: 'ok',
          database: 'connected'
        })
      );
    } catch {
      return reply.status(503).send(
        createErrorResponse(
          'DATABASE_UNAVAILABLE',
          'Database connectivity check failed'
        )
      );
    }
  });
}
