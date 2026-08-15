import { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { readyRoutes } from './ready.js';
import { createSuccessResponse } from '../schemas/response.js';

export async function apiV1Routes(app: FastifyInstance): Promise<void> {
  // Base API v1 Metadata Endpoint
  app.get('/', async () => {
    return createSuccessResponse({
      name: 'RemoteNode Control Plane API',
      version: 'v1',
      documentation: '/api/v1/health'
    });
  });

  // Register Sub-Routes
  await app.register(healthRoutes);
  await app.register(readyRoutes);
}
