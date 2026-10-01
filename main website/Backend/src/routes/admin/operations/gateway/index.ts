import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { assertAdminCanOperateOnResource } from '../middleware/object_authorization.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { resolveClientIp } from '../../../../utils/ip.js';
import { AdminGatewayService } from './service.js';
import {
  gatewayNodeListQuerySchema,
  gatewayNodeParamSchema,
  gatewayConnectionListQuerySchema,
  gatewayMutationActionSchema
} from './schemas.js';

export * from './schemas.js';
export * from './service.js';

export async function adminGatewayOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/gateway/nodes
   * Lists gateway nodes with allowlisted filtering, search, and pagination.
   */
  app.get(
    '/admin/operations/gateway/nodes',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = gatewayNodeListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminGatewayService.listNodes(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/gateway/nodes/:gatewayNodeId
   * Retrieves operational metadata, health summary, and active connections for a specific gateway node.
   */
  app.get(
    '/admin/operations/gateway/nodes/:gatewayNodeId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = gatewayNodeParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid gatewayNodeId parameter');
      }

      const { gatewayNodeId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'gateway',
        resourceId: gatewayNodeId,
        operation: 'read',
        context: request.operationContext!
      });

      const node = await AdminGatewayService.getNodeDetail(gatewayNodeId);
      return reply.status(200).send(createSuccessResponse({ node }));
    }
  );

  /**
   * GET /api/v1/admin/operations/gateway/connections
   * Lists active and historical gateway device connection records with safe pagination.
   */
  app.get(
    '/admin/operations/gateway/connections',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = gatewayConnectionListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminGatewayService.listConnections(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/gateway/telemetry
   * Aggregates infrastructure telemetry across persistent nodes and runtime WebSocket server.
   */
  app.get(
    '/admin/operations/gateway/telemetry',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const telemetry = await AdminGatewayService.getTelemetry();
      return reply.status(200).send(createSuccessResponse({ telemetry }));
    }
  );

  /**
   * GET /api/v1/admin/operations/gateway/diagnostics
   * Returns safe, sanitized diagnostics on gateway process readiness, socket distributions, and node health.
   */
  app.get(
    '/admin/operations/gateway/diagnostics',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const diagnostics = await AdminGatewayService.getDiagnostics();
      return reply.status(200).send(createSuccessResponse({ diagnostics }));
    }
  );

  /**
   * POST /api/v1/admin/operations/gateway/nodes/:gatewayNodeId/drain
   * Drains a gateway node, evicting active connections and placing it in MAINTENANCE mode.
   */
  app.post(
    '/admin/operations/gateway/nodes/:gatewayNodeId/drain',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `gateway_drain_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.drain')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = gatewayNodeParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid gatewayNodeId parameter');
      }

      const parsedBody = gatewayMutationActionSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { gatewayNodeId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'gateway',
        resourceId: gatewayNodeId,
        operation: 'drain',
        context: request.operationContext!
      });

      const result = await AdminGatewayService.drainNode(
        gatewayNodeId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        node: result,
        message: `Gateway node '${result.hostname}' drained successfully into MAINTENANCE state (${result.drainedConnectionsCount} connections evicted)`
      }));
    }
  );

  /**
   * POST /api/v1/admin/operations/gateway/nodes/:gatewayNodeId/restore
   * Restores a drained/maintenance gateway node back to ACTIVE status.
   */
  app.post(
    '/admin/operations/gateway/nodes/:gatewayNodeId/restore',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `gateway_restore_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('gateway.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = gatewayNodeParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid gatewayNodeId parameter');
      }

      const parsedBody = gatewayMutationActionSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { gatewayNodeId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'gateway',
        resourceId: gatewayNodeId,
        operation: 'restore',
        context: request.operationContext!
      });

      const result = await AdminGatewayService.restoreNode(
        gatewayNodeId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        node: result,
        message: `Gateway node '${result.hostname}' restored to ACTIVE status successfully`
      }));
    }
  );
}
