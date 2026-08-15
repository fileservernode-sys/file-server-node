import { FastifyInstance } from 'fastify';
import { createSuccessResponse } from '../schemas/response.js';

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
}
