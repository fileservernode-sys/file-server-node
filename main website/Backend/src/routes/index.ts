import { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { readyRoutes } from './ready.js';
import { authRoutes } from './auth.js';
import { deviceRoutes } from './device.js';
import { serverRoutes } from './server.js';
import { gatewayRoutes } from './gateway.js';
import { connectionRoutes } from './connection.js';
import { endpointRoutes } from './endpoint.js';
import { fileManagerRoutes } from './file-manager.js';
import { pushTokenRoutes, preferenceRoutes, notificationRoutes } from '../notifications/index.js';
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
  await app.register(authRoutes);
  await app.register(deviceRoutes);
  await app.register(serverRoutes);
  await app.register(gatewayRoutes);
  await app.register(connectionRoutes);
  await app.register(endpointRoutes);
  await app.register(fileManagerRoutes);
  await app.register(pushTokenRoutes);
  await app.register(preferenceRoutes);
  await app.register(notificationRoutes);
}
