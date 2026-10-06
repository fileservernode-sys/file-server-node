/**
 * Administrative Server Instance Management API Routes (/api/v1/admin/servers)
 * Phase 17 Batch 17.3 — Device & Server Management
 *
 * Protected by admin authentication, RBAC permissions ('servers.read', 'servers.power'),
 * rate limiting, and tamper-evident SHA-256 audit logging.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminServerService } from './operations/servers/service.js';
import {
  serverListQuerySchema,
  serverParamSchema,
  serverPowerActionSchema
} from './operations/servers/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { resolveClientIp } from '../../utils/ip.js';
import { resolveOperationContext } from './operations/middleware/require_operation_permission.js';

export async function adminServersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/servers/metrics
   * Summary count metrics across customer server instances.
   */
  app.get(
    '/admin/servers/metrics',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('servers.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminServerService.getServerSummaryMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/servers
   * Lists customer server instances with search, filtering, and pagination.
   */
  app.get(
    '/admin/servers',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('servers.read')]
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
   * GET /api/v1/admin/servers/:serverId
   * Retrieves operational metadata and resource overview for a specific server instance.
   */
  app.get(
    '/admin/servers/:serverId',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('servers.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = serverParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid serverId parameter');
      }

      const { serverId } = parsedParam.data;
      const server = await AdminServerService.getServerDetail(serverId);
      return reply.status(200).send(createSuccessResponse({ server }));
    }
  );

  /**
   * POST /api/v1/admin/servers/:serverId/start
   * Starts a stopped or errored server instance.
   */
  app.post(
    '/admin/servers/:serverId/start',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `servers_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('servers.power')]
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
      const context = await resolveOperationContext(request, 'server_start', 'server', serverId);

      const result = await AdminServerService.startServer(
        serverId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' start initiated successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/servers/:serverId/stop
   * Stops an active server instance and evicts active gateway sessions.
   */
  app.post(
    '/admin/servers/:serverId/stop',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `servers_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('servers.power')]
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
      const context = await resolveOperationContext(request, 'server_stop', 'server', serverId);

      const result = await AdminServerService.stopServer(
        serverId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' stopped successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/servers/:serverId/restart
   * Restarts an active server instance.
   */
  app.post(
    '/admin/servers/:serverId/restart',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `servers_power_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('servers.power')]
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
      const context = await resolveOperationContext(request, 'server_restart', 'server', serverId);

      const result = await AdminServerService.restartServer(
        serverId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        server: result,
        message: `Server '${result.serverName || result.id}' restart initiated successfully`
      }));
    }
  );
}
