import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../middleware/admin-auth.js';
import { requireOperationPermission } from './middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../schemas/response.js';
import { adminUserOperationsRoutes } from './users/index.js';
import { adminDeviceOperationsRoutes } from './devices/index.js';
import { adminServerOperationsRoutes } from './servers/index.js';
import { adminGatewayOperationsRoutes } from './gateway/index.js';

export * from './types.js';
export * from './schemas/common.js';
export * from './utils/pagination.js';
export * from './utils/operation_executor.js';
export * from './middleware/require_operation_permission.js';
export * from './middleware/object_authorization.js';
export * from './users/index.js';
export * from './devices/index.js';
export * from './servers/index.js';
export * from './gateway/index.js';

export async function adminOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/health
   * Foundation control plane status endpoint for the Admin Operations API.
   * Requires authenticated AdminSession and 'system.read' permission.
   * Never exposes secrets, database credentials, customer PII, or internal tokens.
   */
  app.get(
    '/admin/operations/health',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const now = new Date();
      return reply.status(200).send(createSuccessResponse({
        status: 'ok',
        service: 'admin-operations',
        version: '8.2',
        timestamp: now.toISOString()
      }));
    }
  );

  // Register Operations Sub-Routes
  await app.register(adminUserOperationsRoutes);
  await app.register(adminDeviceOperationsRoutes);
  await app.register(adminServerOperationsRoutes);
  await app.register(adminGatewayOperationsRoutes);
}
