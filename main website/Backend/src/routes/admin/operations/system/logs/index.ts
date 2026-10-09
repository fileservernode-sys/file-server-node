/**
 * Admin System Logs & Diagnostics Operations Routes
 * Phase 17 Batch 17.5 — System Logs & Diagnostics
 *
 * Namespace: /api/v1/admin/operations/system/logs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../../middleware/admin-auth.js';
import { requireOperationPermission, resolveOperationContext } from '../../middleware/require_operation_permission.js';
import { AdminSystemLogsService } from './service.js';
import {
  systemErrorQuerySchema,
  systemErrorParamSchema,
  systemEventQuerySchema,
  gatewayDiagnosticsQuerySchema,
  systemIncidentQuerySchema,
  systemLogsExportQuerySchema
} from './schemas.js';
import { createSuccessResponse } from '../../../../../schemas/response.js';
import { ValidationError } from '../../../../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../../../../middleware/rate_limit_presets.js';

export async function adminSystemLogsOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/system/logs/metrics
   * Summary counts and operational health aggregates.
   */
  app.get(
    '/admin/operations/system/logs/metrics',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminSystemLogsService.getLogsMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/errors
   * Paginated error occurrences with multi-attribute filtering and bounded search.
   */
  app.get(
    '/admin/operations/system/logs/errors',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemErrorQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid error query parameters');
      }

      const result = await AdminSystemLogsService.listErrors(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/errors/:id
   * Detailed occurrence telemetry with sanitized stack traces.
   */
  app.get(
    '/admin/operations/system/logs/errors/:id',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemErrorParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid error occurrence ID');
      }

      const detail = await AdminSystemLogsService.getErrorDetail(params.data.id);
      return reply.status(200).send(createSuccessResponse({ error: detail }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/events
   * Paginated operational and audit event stream.
   */
  app.get(
    '/admin/operations/system/logs/events',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemEventQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid event query parameters');
      }

      const result = await AdminSystemLogsService.listEvents(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/gateway
   * Paginated gateway diagnostics and device connection sessions.
   */
  app.get(
    '/admin/operations/system/logs/gateway',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = gatewayDiagnosticsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid gateway diagnostic query parameters');
      }

      const result = await AdminSystemLogsService.getGatewayDiagnostics(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/incidents
   * Paginated error incidents with linked fingerprint aggregates.
   */
  app.get(
    '/admin/operations/system/logs/incidents',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemIncidentQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid incident query parameters');
      }

      const result = await AdminSystemLogsService.listIncidents(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/logs/export
   * Generates a controlled, bounded, sanitized export (CSV or JSON).
   */
  app.get(
    '/admin/operations/system/logs/export',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemLogsExportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid export query parameters');
      }

      const context = await resolveOperationContext(request);
      const result = await AdminSystemLogsService.exportLogs(parsed.data as any, context);

      reply.header('Content-Type', result.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
      return reply.status(200).send(result.data);
    }
  );
}

export * from './types.js';
export * from './schemas.js';
export * from './service.js';
