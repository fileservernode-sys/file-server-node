import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { assertAdminCanOperateOnResource } from '../middleware/object_authorization.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { resolveClientIp } from '../../../../utils/ip.js';
import { AdminServerService } from './service.js';
import {
  serverListQuerySchema,
  serverParamSchema,
  serverPowerActionSchema
} from './schemas.js';

export * from './schemas.js';
export * from './service.js';

export async function adminServerOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/servers
   * Lists customer server instances with allowlisted filtering, search, and pagination.
   */
  app.get(
    '/admin/operations/servers',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('servers.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = serverListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminServerService.listServers(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/servers/:serverId
   * Retrieves operational metadata and resource overview for a specific server instance.
   */
  app.get(
    '/admin/operations/servers/:serverId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('servers.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = serverParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid serverId parameter');
      }

      const { serverId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'server',
        resourceId: serverId,
        operation: 'read',
        context: request.operationContext!
      });

      const server = await AdminServerService.getServerDetail(serverId);
      return reply.status(200).send(createSuccessResponse({ server }));
    }
  );

  /**
   * POST /api/v1/admin/operations/servers/:serverId/start
   * Starts a stopped or errored server instance.
   */
  app.post(
    '/admin/operations/servers/:serverId/start',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `server_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('servers.power')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = serverParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid serverId parameter');
      }

      const parsedBody = serverPowerActionSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { serverId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'server',
        resourceId: serverId,
        operation: 'start',
        context: request.operationContext!
      });

      const result = await AdminServerService.startServer(
        serverId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' start initiated successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/operations/servers/:serverId/stop
   * Stops an active server instance and evicts active gateway sessions.
   */
  app.post(
    '/admin/operations/servers/:serverId/stop',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `server_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('servers.power')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = serverParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid serverId parameter');
      }

      const parsedBody = serverPowerActionSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { serverId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'server',
        resourceId: serverId,
        operation: 'stop',
        context: request.operationContext!
      });

      const result = await AdminServerService.stopServer(
        serverId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' stopped successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/operations/servers/:serverId/restart
   * Restarts an active server instance.
   */
  app.post(
    '/admin/operations/servers/:serverId/restart',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `server_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('servers.power')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = serverParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid serverId parameter');
      }

      const parsedBody = serverPowerActionSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { serverId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'server',
        resourceId: serverId,
        operation: 'restart',
        context: request.operationContext!
      });

      const result = await AdminServerService.restartServer(
        serverId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' restart initiated successfully`
      }));
    }
  );
}
