import { FastifyInstance, FastifyReply } from 'fastify';
import { checkDatabaseReadiness } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';

export async function readyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/ready
   * Service Readiness Probe: Tests active database connection availability.
   */
  app.get('/ready', async (_request, reply: FastifyReply) => {
    const isDbConnected = await checkDatabaseReadiness();

    if (isDbConnected) {
      return reply.status(200).send(createSuccessResponse({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString()
      }));
    } else {
      return reply.status(503).send(createErrorResponse(
        'SERVICE_UNAVAILABLE',
        'Database connection is not ready'
      ));
    }
  });
}
